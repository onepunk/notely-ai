/**
 * EncryptionHelper - Native C++ implementation using OpenSSL
 *
 * Replaces Node.js crypto calls with direct OpenSSL EVP API for:
 * - AES-256-GCM encrypt/decrypt
 * - PBKDF2-SHA512 key derivation (async via Napi::AsyncWorker)
 * - SHA-256/SHA-512 hashing
 * - HMAC generation
 * - Timing-safe comparison
 * - Secure random byte generation
 */

#include "encryption.h"

#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>
#include <openssl/crypto.h>

#include <cstring>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

namespace notely {

static constexpr int AES_KEY_LENGTH = 32;   // 256 bits
static constexpr int AES_IV_LENGTH  = 12;   // 96 bits (GCM recommended)
static constexpr int AES_TAG_LENGTH = 16;   // 128 bits

// ---- Helpers ----

static std::string ToHex(const unsigned char* data, size_t len) {
  std::ostringstream oss;
  oss << std::hex << std::setfill('0');
  for (size_t i = 0; i < len; i++) {
    oss << std::setw(2) << static_cast<int>(data[i]);
  }
  return oss.str();
}

// ---- AES-256-GCM Encrypt ----

static Napi::Value EncryptAesGcm(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsString()) {
    Napi::Error::New(env, "Expected (Buffer key, String data)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto keyBuf = info[0].As<Napi::Buffer<unsigned char>>();
  std::string data = info[1].As<Napi::String>().Utf8Value();

  if (keyBuf.Length() != AES_KEY_LENGTH) {
    Napi::Error::New(env, "Key must be 32 bytes long").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Generate random IV
  unsigned char iv[AES_IV_LENGTH];
  if (RAND_bytes(iv, AES_IV_LENGTH) != 1) {
    Napi::Error::New(env, "Failed to generate random IV").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
  if (!ctx) {
    Napi::Error::New(env, "Failed to create cipher context").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::vector<unsigned char> ciphertext(data.size() + EVP_MAX_BLOCK_LENGTH);
  unsigned char tag[AES_TAG_LENGTH];
  int outLen = 0, finalLen = 0;

  bool ok = true;
  ok = ok && EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) == 1;
  ok = ok && EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, AES_IV_LENGTH, nullptr) == 1;
  ok = ok && EVP_EncryptInit_ex(ctx, nullptr, nullptr, keyBuf.Data(), iv) == 1;
  ok = ok && EVP_EncryptUpdate(ctx, ciphertext.data(), &outLen,
                               reinterpret_cast<const unsigned char*>(data.c_str()),
                               static_cast<int>(data.size())) == 1;
  ok = ok && EVP_EncryptFinal_ex(ctx, ciphertext.data() + outLen, &finalLen) == 1;
  ok = ok && EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, AES_TAG_LENGTH, tag) == 1;

  EVP_CIPHER_CTX_free(ctx);

  if (!ok) {
    Napi::Error::New(env, "AES-GCM encryption failed").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  int totalLen = outLen + finalLen;

  Napi::Object result = Napi::Object::New(env);
  result.Set("cipher", Napi::Buffer<unsigned char>::Copy(env, ciphertext.data(), totalLen));
  result.Set("iv", Napi::Buffer<unsigned char>::Copy(env, iv, AES_IV_LENGTH));
  result.Set("tag", Napi::Buffer<unsigned char>::Copy(env, tag, AES_TAG_LENGTH));

  return result;
}

// ---- AES-256-GCM Decrypt ----

static Napi::Value DecryptAesGcm(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 4 || !info[0].IsBuffer() || !info[1].IsBuffer() ||
      !info[2].IsBuffer() || !info[3].IsBuffer()) {
    Napi::Error::New(env, "Expected (Buffer key, Buffer cipher, Buffer iv, Buffer tag)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto keyBuf    = info[0].As<Napi::Buffer<unsigned char>>();
  auto cipherBuf = info[1].As<Napi::Buffer<unsigned char>>();
  auto ivBuf     = info[2].As<Napi::Buffer<unsigned char>>();
  auto tagBuf    = info[3].As<Napi::Buffer<unsigned char>>();

  if (keyBuf.Length() != AES_KEY_LENGTH) {
    Napi::Error::New(env, "Key must be 32 bytes long").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
  if (!ctx) {
    Napi::Error::New(env, "Failed to create cipher context").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::vector<unsigned char> plaintext(cipherBuf.Length() + EVP_MAX_BLOCK_LENGTH);
  int outLen = 0, finalLen = 0;

  bool ok = true;
  ok = ok && EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) == 1;
  ok = ok && EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN,
                                 static_cast<int>(ivBuf.Length()), nullptr) == 1;
  ok = ok && EVP_DecryptInit_ex(ctx, nullptr, nullptr, keyBuf.Data(), ivBuf.Data()) == 1;
  ok = ok && EVP_DecryptUpdate(ctx, plaintext.data(), &outLen,
                               cipherBuf.Data(),
                               static_cast<int>(cipherBuf.Length())) == 1;
  ok = ok && EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, static_cast<int>(tagBuf.Length()),
                                 const_cast<unsigned char*>(tagBuf.Data())) == 1;

  int finalResult = EVP_DecryptFinal_ex(ctx, plaintext.data() + outLen, &finalLen);
  EVP_CIPHER_CTX_free(ctx);

  if (!ok || finalResult != 1) {
    Napi::Error::New(env, "AES-GCM decryption failed (authentication)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  int totalLen = outLen + finalLen;
  return Napi::String::New(env, reinterpret_cast<const char*>(plaintext.data()), totalLen);
}

// ---- PBKDF2 Async Worker ----

class Pbkdf2Worker : public Napi::AsyncWorker {
 public:
  Pbkdf2Worker(Napi::Env env, const std::string& password,
               const std::vector<unsigned char>& salt,
               int iterations, int keyLength,
               Napi::Promise::Deferred deferred)
      : Napi::AsyncWorker(env),
        password_(password),
        salt_(salt),
        iterations_(iterations),
        keyLength_(keyLength),
        deferred_(deferred),
        derivedKey_(keyLength) {}

  void Execute() override {
    int rc = PKCS5_PBKDF2_HMAC(
        password_.c_str(), static_cast<int>(password_.size()),
        salt_.data(), static_cast<int>(salt_.size()),
        iterations_, EVP_sha512(),
        keyLength_, derivedKey_.data());
    if (rc != 1) {
      SetError("PBKDF2 key derivation failed");
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    auto buf = Napi::Buffer<unsigned char>::Copy(env, derivedKey_.data(), derivedKey_.size());
    deferred_.Resolve(buf);
  }

  void OnError(const Napi::Error& error) override {
    deferred_.Reject(error.Value());
  }

 private:
  std::string password_;
  std::vector<unsigned char> salt_;
  int iterations_;
  int keyLength_;
  Napi::Promise::Deferred deferred_;
  std::vector<unsigned char> derivedKey_;
};

static Napi::Value DeriveKeyFromPassword(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 4 || !info[0].IsString() || !info[1].IsBuffer() ||
      !info[2].IsNumber() || !info[3].IsNumber()) {
    Napi::Error::New(env, "Expected (String password, Buffer salt, Number iterations, Number keyLength)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string password = info[0].As<Napi::String>().Utf8Value();
  auto saltBuf = info[1].As<Napi::Buffer<unsigned char>>();
  int iterations = info[2].As<Napi::Number>().Int32Value();
  int keyLength = info[3].As<Napi::Number>().Int32Value();

  std::vector<unsigned char> salt(saltBuf.Data(), saltBuf.Data() + saltBuf.Length());

  auto deferred = Napi::Promise::Deferred::New(env);
  auto* worker = new Pbkdf2Worker(env, password, salt, iterations, keyLength, deferred);
  worker->Queue();

  return deferred.Promise();
}

// ---- Hash ----

static Napi::Value GenerateHash(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::Error::New(env, "Expected (String data, String algorithm)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string data = info[0].As<Napi::String>().Utf8Value();
  std::string algo = info[1].As<Napi::String>().Utf8Value();

  const EVP_MD* md = nullptr;
  if (algo == "sha256") {
    md = EVP_sha256();
  } else if (algo == "sha512") {
    md = EVP_sha512();
  } else {
    Napi::Error::New(env, "Unsupported algorithm: " + algo).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  unsigned char digest[EVP_MAX_MD_SIZE];
  unsigned int digestLen = 0;

  EVP_MD_CTX* ctx = EVP_MD_CTX_new();
  bool ok = ctx != nullptr;
  ok = ok && EVP_DigestInit_ex(ctx, md, nullptr) == 1;
  ok = ok && EVP_DigestUpdate(ctx, data.c_str(), data.size()) == 1;
  ok = ok && EVP_DigestFinal_ex(ctx, digest, &digestLen) == 1;
  EVP_MD_CTX_free(ctx);

  if (!ok) {
    Napi::Error::New(env, "Hash computation failed").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  return Napi::String::New(env, ToHex(digest, digestLen));
}

// ---- HMAC ----

static Napi::Value GenerateHmac(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 3 || !info[0].IsBuffer() || !info[1].IsString() || !info[2].IsString()) {
    Napi::Error::New(env, "Expected (Buffer key, String data, String algorithm)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto keyBuf = info[0].As<Napi::Buffer<unsigned char>>();
  std::string data = info[1].As<Napi::String>().Utf8Value();
  std::string algo = info[2].As<Napi::String>().Utf8Value();

  const EVP_MD* md = nullptr;
  if (algo == "sha256") {
    md = EVP_sha256();
  } else if (algo == "sha512") {
    md = EVP_sha512();
  } else {
    Napi::Error::New(env, "Unsupported algorithm: " + algo).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  unsigned char result[EVP_MAX_MD_SIZE];
  unsigned int resultLen = 0;

  HMAC(md, keyBuf.Data(), static_cast<int>(keyBuf.Length()),
       reinterpret_cast<const unsigned char*>(data.c_str()),
       data.size(), result, &resultLen);

  return Napi::String::New(env, ToHex(result, resultLen));
}

// ---- Secure Compare ----

static Napi::Value SecureCompare(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::Error::New(env, "Expected (String a, String b)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string a = info[0].As<Napi::String>().Utf8Value();
  std::string b = info[1].As<Napi::String>().Utf8Value();

  if (a.size() != b.size()) {
    return Napi::Boolean::New(env, false);
  }

  int result = CRYPTO_memcmp(a.c_str(), b.c_str(), a.size());
  return Napi::Boolean::New(env, result == 0);
}

// ---- Random Bytes ----

static Napi::Value RandomBytes(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::Error::New(env, "Expected (Number length)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  int length = info[0].As<Napi::Number>().Int32Value();
  if (length <= 0 || length > 1024 * 1024) {
    Napi::Error::New(env, "Length must be between 1 and 1048576").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto buf = Napi::Buffer<unsigned char>::New(env, length);
  if (RAND_bytes(buf.Data(), length) != 1) {
    Napi::Error::New(env, "Failed to generate random bytes").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  return buf;
}

// ---- Generate ID (UUID v4) ----

static Napi::Value GenerateId(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  unsigned char bytes[16];
  if (RAND_bytes(bytes, 16) != 1) {
    Napi::Error::New(env, "Failed to generate random bytes for UUID").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Set version 4 (random) and variant 1 (RFC 4122)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;  // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80;  // variant 1

  char uuid[37];
  snprintf(uuid, sizeof(uuid),
           "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           bytes[0], bytes[1], bytes[2], bytes[3],
           bytes[4], bytes[5], bytes[6], bytes[7],
           bytes[8], bytes[9], bytes[10], bytes[11],
           bytes[12], bytes[13], bytes[14], bytes[15]);

  return Napi::String::New(env, uuid);
}

// ---- Registration ----

void RegisterEncryption(Napi::Env env, Napi::Object exports) {
  exports.Set("encryptAesGcm", Napi::Function::New(env, EncryptAesGcm));
  exports.Set("decryptAesGcm", Napi::Function::New(env, DecryptAesGcm));
  exports.Set("deriveKeyFromPassword", Napi::Function::New(env, DeriveKeyFromPassword));
  exports.Set("generateHash", Napi::Function::New(env, GenerateHash));
  exports.Set("generateHmac", Napi::Function::New(env, GenerateHmac));
  exports.Set("secureCompare", Napi::Function::New(env, SecureCompare));
  exports.Set("randomBytes", Napi::Function::New(env, RandomBytes));
  exports.Set("generateId", Napi::Function::New(env, GenerateId));
}

}  // namespace notely
