/**
 * Password Protection Crypto - Native C++ implementation
 *
 * Handles password-to-key derivation and key blob encryption/decryption.
 * Both operations use Napi::AsyncWorker since PBKDF2 with 600k iterations
 * is CPU-intensive and would block the Node.js event loop.
 *
 * Scheme: PBKDF2-SHA512 (600k iterations) + AES-256-GCM
 */

#include "password_crypto.h"

#include <openssl/evp.h>
#include <openssl/rand.h>

#include <cstring>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

namespace notely {

static constexpr int PBKDF2_ITERATIONS = 600000;
static constexpr int PBKDF2_KEY_LENGTH = 32;  // AES-256
static constexpr int PBKDF2_SALT_LENGTH = 32;
static constexpr int AES_IV_LEN = 12;
static constexpr int AES_TAG_LEN = 16;

// ---- Helpers ----

static std::string ToHex(const unsigned char* data, size_t len) {
  std::ostringstream oss;
  oss << std::hex << std::setfill('0');
  for (size_t i = 0; i < len; i++) {
    oss << std::setw(2) << static_cast<int>(data[i]);
  }
  return oss.str();
}

static std::vector<unsigned char> FromHex(const std::string& hex) {
  std::vector<unsigned char> bytes;
  bytes.reserve(hex.size() / 2);
  for (size_t i = 0; i + 1 < hex.size(); i += 2) {
    unsigned char byte = static_cast<unsigned char>(std::stoi(hex.substr(i, 2), nullptr, 16));
    bytes.push_back(byte);
  }
  return bytes;
}

// ---- Encrypt Key Worker ----

class EncryptKeyWorker : public Napi::AsyncWorker {
 public:
  EncryptKeyWorker(Napi::Env env, const std::string& keyHex,
                   const std::string& password, Napi::Promise::Deferred deferred)
      : Napi::AsyncWorker(env),
        keyHex_(keyHex),
        password_(password),
        deferred_(deferred) {}

  void Execute() override {
    // Generate random salt
    salt_.resize(PBKDF2_SALT_LENGTH);
    if (RAND_bytes(salt_.data(), PBKDF2_SALT_LENGTH) != 1) {
      SetError("Failed to generate random salt");
      return;
    }

    // Derive key from password
    std::vector<unsigned char> derivedKey(PBKDF2_KEY_LENGTH);
    if (PKCS5_PBKDF2_HMAC(password_.c_str(), static_cast<int>(password_.size()),
                           salt_.data(), static_cast<int>(salt_.size()),
                           PBKDF2_ITERATIONS, EVP_sha512(),
                           PBKDF2_KEY_LENGTH, derivedKey.data()) != 1) {
      SetError("PBKDF2 key derivation failed");
      return;
    }

    // Generate random IV
    iv_.resize(AES_IV_LEN);
    if (RAND_bytes(iv_.data(), AES_IV_LEN) != 1) {
      SetError("Failed to generate random IV");
      return;
    }

    // Parse key hex to bytes
    std::vector<unsigned char> keyBytes = FromHex(keyHex_);

    // Encrypt with AES-256-GCM
    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    if (!ctx) {
      SetError("Failed to create cipher context");
      return;
    }

    encrypted_.resize(keyBytes.size() + EVP_MAX_BLOCK_LENGTH);
    tag_.resize(AES_TAG_LEN);
    int outLen = 0, finalLen = 0;

    bool ok = true;
    ok = ok && EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) == 1;
    ok = ok && EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, AES_IV_LEN, nullptr) == 1;
    ok = ok && EVP_EncryptInit_ex(ctx, nullptr, nullptr, derivedKey.data(), iv_.data()) == 1;
    ok = ok && EVP_EncryptUpdate(ctx, encrypted_.data(), &outLen,
                                 keyBytes.data(), static_cast<int>(keyBytes.size())) == 1;
    ok = ok && EVP_EncryptFinal_ex(ctx, encrypted_.data() + outLen, &finalLen) == 1;
    ok = ok && EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, AES_TAG_LEN, tag_.data()) == 1;

    EVP_CIPHER_CTX_free(ctx);

    if (!ok) {
      SetError("AES-GCM encryption failed");
      return;
    }

    encryptedLen_ = outLen + finalLen;

    // Zero out sensitive data
    OPENSSL_cleanse(derivedKey.data(), derivedKey.size());
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Object result = Napi::Object::New(env);

    result.Set("salt", Napi::String::New(env, ToHex(salt_.data(), salt_.size())));
    result.Set("iv", Napi::String::New(env, ToHex(iv_.data(), iv_.size())));
    result.Set("authTag", Napi::String::New(env, ToHex(tag_.data(), tag_.size())));
    result.Set("encryptedKey", Napi::String::New(env, ToHex(encrypted_.data(), encryptedLen_)));
    result.Set("iterations", Napi::Number::New(env, PBKDF2_ITERATIONS));
    result.Set("version", Napi::Number::New(env, 1));

    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& error) override {
    deferred_.Reject(error.Value());
  }

 private:
  std::string keyHex_;
  std::string password_;
  Napi::Promise::Deferred deferred_;
  std::vector<unsigned char> salt_;
  std::vector<unsigned char> iv_;
  std::vector<unsigned char> tag_;
  std::vector<unsigned char> encrypted_;
  int encryptedLen_ = 0;
};

// ---- Decrypt Key Worker ----

class DecryptKeyWorker : public Napi::AsyncWorker {
 public:
  DecryptKeyWorker(Napi::Env env,
                   const std::string& saltHex, const std::string& ivHex,
                   const std::string& tagHex, const std::string& encryptedHex,
                   int iterations, const std::string& password,
                   Napi::Promise::Deferred deferred)
      : Napi::AsyncWorker(env),
        saltHex_(saltHex), ivHex_(ivHex), tagHex_(tagHex),
        encryptedHex_(encryptedHex), iterations_(iterations),
        password_(password), deferred_(deferred) {}

  void Execute() override {
    std::vector<unsigned char> salt = FromHex(saltHex_);
    std::vector<unsigned char> iv = FromHex(ivHex_);
    std::vector<unsigned char> tag = FromHex(tagHex_);
    std::vector<unsigned char> encrypted = FromHex(encryptedHex_);

    // Derive key
    std::vector<unsigned char> derivedKey(PBKDF2_KEY_LENGTH);
    if (PKCS5_PBKDF2_HMAC(password_.c_str(), static_cast<int>(password_.size()),
                           salt.data(), static_cast<int>(salt.size()),
                           iterations_, EVP_sha512(),
                           PBKDF2_KEY_LENGTH, derivedKey.data()) != 1) {
      SetError("PBKDF2 key derivation failed");
      return;
    }

    // Decrypt
    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    if (!ctx) {
      SetError("Failed to create cipher context");
      return;
    }

    decrypted_.resize(encrypted.size() + EVP_MAX_BLOCK_LENGTH);
    int outLen = 0, finalLen = 0;

    bool ok = true;
    ok = ok && EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) == 1;
    ok = ok && EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, AES_IV_LEN, nullptr) == 1;
    ok = ok && EVP_DecryptInit_ex(ctx, nullptr, nullptr, derivedKey.data(), iv.data()) == 1;
    ok = ok && EVP_DecryptUpdate(ctx, decrypted_.data(), &outLen,
                                 encrypted.data(), static_cast<int>(encrypted.size())) == 1;
    ok = ok && EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG,
                                   static_cast<int>(tag.size()),
                                   const_cast<unsigned char*>(tag.data())) == 1;

    int finalResult = EVP_DecryptFinal_ex(ctx, decrypted_.data() + outLen, &finalLen);
    EVP_CIPHER_CTX_free(ctx);

    // Zero out derived key
    OPENSSL_cleanse(derivedKey.data(), derivedKey.size());

    if (!ok || finalResult != 1) {
      SetError("Incorrect password");
      return;
    }

    decryptedLen_ = outLen + finalLen;
  }

  void OnOK() override {
    Napi::Env env = Env();
    std::string hex = ToHex(decrypted_.data(), decryptedLen_);
    // Zero out decrypted data in memory
    OPENSSL_cleanse(decrypted_.data(), decrypted_.size());
    deferred_.Resolve(Napi::String::New(env, hex));
  }

  void OnError(const Napi::Error& error) override {
    deferred_.Reject(error.Value());
  }

 private:
  std::string saltHex_, ivHex_, tagHex_, encryptedHex_;
  int iterations_;
  std::string password_;
  Napi::Promise::Deferred deferred_;
  std::vector<unsigned char> decrypted_;
  int decryptedLen_ = 0;
};

// ---- N-API exports ----

static Napi::Value EncryptKeyWithPassword(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::Error::New(env, "Expected (String keyHex, String password)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string keyHex = info[0].As<Napi::String>().Utf8Value();
  std::string password = info[1].As<Napi::String>().Utf8Value();

  auto deferred = Napi::Promise::Deferred::New(env);
  auto* worker = new EncryptKeyWorker(env, keyHex, password, deferred);
  worker->Queue();

  return deferred.Promise();
}

static Napi::Value DecryptKeyWithPassword(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsString()) {
    Napi::Error::New(env, "Expected (Object blob, String password)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Object blob = info[0].As<Napi::Object>();
  std::string password = info[1].As<Napi::String>().Utf8Value();

  std::string saltHex = blob.Get("salt").As<Napi::String>().Utf8Value();
  std::string ivHex = blob.Get("iv").As<Napi::String>().Utf8Value();
  std::string tagHex = blob.Get("authTag").As<Napi::String>().Utf8Value();
  std::string encryptedHex = blob.Get("encryptedKey").As<Napi::String>().Utf8Value();
  int iterations = blob.Get("iterations").As<Napi::Number>().Int32Value();

  auto deferred = Napi::Promise::Deferred::New(env);
  auto* worker = new DecryptKeyWorker(env, saltHex, ivHex, tagHex, encryptedHex,
                                      iterations, password, deferred);
  worker->Queue();

  return deferred.Promise();
}

// ---- Registration ----

void RegisterPasswordCrypto(Napi::Env env, Napi::Object exports) {
  exports.Set("encryptKeyWithPassword", Napi::Function::New(env, EncryptKeyWithPassword));
  exports.Set("decryptKeyWithPassword", Napi::Function::New(env, DecryptKeyWithPassword));
}

}  // namespace notely
