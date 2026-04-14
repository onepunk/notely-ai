/**
 * Certificate Pin Configuration - Native C++ implementation
 *
 * Stores SPKI pin values as obfuscated byte arrays (not string literals).
 * Implements domain matching with wildcard support and SPKI hash computation.
 */

#include "pinning.h"

#include <openssl/evp.h>
#include <openssl/x509.h>
#include <openssl/bio.h>
#include <openssl/pem.h>

#include <algorithm>
#include <cstring>
#include <string>
#include <vector>

namespace notely {

// ---- Obfuscated Pin Storage ----
// Pins stored as raw bytes rather than readable base64 strings.
// Each pin is the raw 32-byte SHA-256 digest of the SPKI.
// At runtime we base64-encode them for comparison with JS-side pins.

static const unsigned char PIN_NOTELY_LEAF[] = {
  0xe4, 0x39, 0x5a, 0xfa, 0x0a, 0xf0, 0x23, 0xa6, 0xa3, 0x8d, 0x5c, 0xd3, 0x7b, 0x34, 0x2d, 0x48,
  0x41, 0xc7, 0x71, 0x0e, 0xe4, 0xd2, 0x6a, 0x15, 0x14, 0x6b, 0xfb, 0xc3, 0x58, 0x77, 0xa9, 0x6e
};

static const unsigned char PIN_GTS_WE1[] = {
  0x90, 0x87, 0x69, 0xe8, 0xd3, 0x44, 0x77, 0xcc, 0x2c, 0xba, 0x06, 0x32, 0xc8, 0x86, 0x05, 0xb2,
  0x2d, 0x72, 0x94, 0xc0, 0x84, 0x0f, 0x78, 0x59, 0x6d, 0x24, 0x7c, 0x64, 0x5b, 0x1a, 0xfc, 0x0e
};

static const unsigned char PIN_GTS_ROOT_R4[] = {
  0x98, 0x47, 0xe5, 0x65, 0x3e, 0x5e, 0x9e, 0x84, 0x75, 0x16, 0xe5, 0xcb, 0x81, 0x86, 0x06, 0xaa,
  0x75, 0x44, 0xa1, 0x9b, 0xe6, 0x7f, 0xd7, 0x36, 0x6d, 0x50, 0x69, 0x88, 0xe8, 0xd8, 0x43, 0x47
};

static const unsigned char PIN_GTS_ROOT_R1[] = {
  0x87, 0x1a, 0x91, 0x94, 0xf4, 0xee, 0xd5, 0xb3, 0x12, 0xff, 0x40, 0xc8, 0x4c, 0x1d, 0x52, 0x4a,
  0xed, 0x2f, 0x77, 0x8b, 0xbf, 0xf2, 0x5f, 0x13, 0x8c, 0xf8, 0x1f, 0x68, 0x0a, 0x7a, 0xdc, 0x67
};

static const unsigned char PIN_GTS_ROOT_R2[] = {
  0x19, 0x14, 0x17, 0xe0, 0x00, 0x37, 0x0a, 0x3b, 0x03, 0x3c, 0xcf, 0xf2, 0x2d, 0xf0, 0x4a, 0x26,
  0x0e, 0xff, 0x01, 0x80, 0x3b, 0x10, 0xb3, 0x12, 0x39, 0x3f, 0x95, 0x71, 0x4d, 0x12, 0x0b, 0xe0
};

static const unsigned char PIN_GLOBALSIGN_ROOT[] = {
  0x2b, 0xce, 0xe8, 0x58, 0x15, 0x8c, 0xf5, 0x46, 0x5f, 0xc9, 0xd7, 0x6f, 0x0d, 0xfa, 0x31, 0x2f,
  0xef, 0x25, 0xa4, 0xdc, 0xa8, 0x50, 0x1d, 0xa9, 0xb4, 0x6b, 0x67, 0xd1, 0xfb, 0xfa, 0x1b, 0x64
};

// ---- Base64 encode ----

static const char B64_TABLE[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static std::string Base64Encode(const unsigned char* data, size_t len) {
  std::string out;
  out.reserve(((len + 2) / 3) * 4);

  for (size_t i = 0; i < len; i += 3) {
    unsigned int n = static_cast<unsigned int>(data[i]) << 16;
    if (i + 1 < len) n |= static_cast<unsigned int>(data[i + 1]) << 8;
    if (i + 2 < len) n |= static_cast<unsigned int>(data[i + 2]);

    out += B64_TABLE[(n >> 18) & 0x3f];
    out += B64_TABLE[(n >> 12) & 0x3f];
    out += (i + 1 < len) ? B64_TABLE[(n >> 6) & 0x3f] : '=';
    out += (i + 2 < len) ? B64_TABLE[n & 0x3f] : '=';
  }

  return out;
}

// ---- Pin list ----

struct PinData {
  const unsigned char* bytes;
  size_t len;
};

static const PinData ALL_PINS[] = {
  { PIN_NOTELY_LEAF,     sizeof(PIN_NOTELY_LEAF) },
  { PIN_GTS_WE1,         sizeof(PIN_GTS_WE1) },
  { PIN_GTS_ROOT_R4,     sizeof(PIN_GTS_ROOT_R4) },
  { PIN_GTS_ROOT_R1,     sizeof(PIN_GTS_ROOT_R1) },
  { PIN_GTS_ROOT_R2,     sizeof(PIN_GTS_ROOT_R2) },
  { PIN_GLOBALSIGN_ROOT, sizeof(PIN_GLOBALSIGN_ROOT) },
};

static constexpr size_t NUM_PINS = sizeof(ALL_PINS) / sizeof(ALL_PINS[0]);

// ---- Domain matching ----

static bool MatchesDomain(const std::string& hostname, const std::string& pattern) {
  if (hostname == pattern) return true;

  // Wildcard match: *.example.com
  if (pattern.size() > 2 && pattern[0] == '*' && pattern[1] == '.') {
    std::string base = pattern.substr(2);
    if (hostname == base) return true;
    if (hostname.size() > base.size() + 1 &&
        hostname.compare(hostname.size() - base.size() - 1, base.size() + 1, "." + base) == 0) {
      return true;
    }
  }

  return false;
}

static bool IsNotelyDomain(const std::string& hostname) {
  return MatchesDomain(hostname, "*.yourdomain.com") || MatchesDomain(hostname, "yourdomain.com");
}

// ---- N-API exports ----

static Napi::Value GetPinsForDomain(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::Error::New(env, "Expected (String hostname)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string hostname = info[0].As<Napi::String>().Utf8Value();

  Napi::Array result = Napi::Array::New(env);

  if (IsNotelyDomain(hostname)) {
    for (size_t i = 0; i < NUM_PINS; i++) {
      std::string b64 = Base64Encode(ALL_PINS[i].bytes, ALL_PINS[i].len);
      result.Set(static_cast<uint32_t>(i), Napi::String::New(env, b64));
    }
  }

  return result;
}

static Napi::Value RequiresPinning(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    return Napi::Boolean::New(env, false);
  }

  std::string hostname = info[0].As<Napi::String>().Utf8Value();
  return Napi::Boolean::New(env, IsNotelyDomain(hostname));
}

static Napi::Value RequiresPinningWithPort(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    return Napi::Boolean::New(env, false);
  }

  std::string hostname = info[0].As<Napi::String>().Utf8Value();

  int port = 443;
  if (info.Length() >= 2 && info[1].IsNumber()) {
    port = info[1].As<Napi::Number>().Int32Value();
  }

  if (port != 443) {
    return Napi::Boolean::New(env, false);
  }

  return Napi::Boolean::New(env, IsNotelyDomain(hostname));
}

static Napi::Value RequiresPinningForUrl(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    return Napi::Boolean::New(env, false);
  }

  std::string url = info[0].As<Napi::String>().Utf8Value();

  // Simple URL parsing for scheme://host:port/path
  size_t schemeEnd = url.find("://");
  if (schemeEnd == std::string::npos) {
    return Napi::Boolean::New(env, false);
  }

  std::string scheme = url.substr(0, schemeEnd);
  size_t hostStart = schemeEnd + 3;
  size_t hostEnd = url.find_first_of(":/", hostStart);
  if (hostEnd == std::string::npos) hostEnd = url.size();

  std::string hostname = url.substr(hostStart, hostEnd - hostStart);

  int port = (scheme == "https" || scheme == "wss") ? 443 : 80;
  if (hostEnd < url.size() && url[hostEnd] == ':') {
    size_t portEnd = url.find('/', hostEnd);
    if (portEnd == std::string::npos) portEnd = url.size();
    std::string portStr = url.substr(hostEnd + 1, portEnd - hostEnd - 1);
    try {
      port = std::stoi(portStr);
    } catch (...) {
      // Use default
    }
  }

  if (port != 443) {
    return Napi::Boolean::New(env, false);
  }

  return Napi::Boolean::New(env, IsNotelyDomain(hostname));
}

static Napi::Value ComputeSpkiPin(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::Error::New(env, "Expected (Buffer derCert)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto certBuf = info[0].As<Napi::Buffer<unsigned char>>();
  const unsigned char* certData = certBuf.Data();
  long certLen = static_cast<long>(certBuf.Length());

  // Parse DER certificate
  X509* cert = d2i_X509(nullptr, &certData, certLen);
  if (!cert) {
    Napi::Error::New(env, "Failed to parse DER certificate").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // Extract SPKI in DER format
  int spkiLen = i2d_X509_PUBKEY(X509_get_X509_PUBKEY(cert), nullptr);
  if (spkiLen <= 0) {
    X509_free(cert);
    Napi::Error::New(env, "Failed to extract SPKI").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::vector<unsigned char> spkiDer(spkiLen);
  unsigned char* spkiPtr = spkiDer.data();
  i2d_X509_PUBKEY(X509_get_X509_PUBKEY(cert), &spkiPtr);
  X509_free(cert);

  // SHA-256 hash of SPKI
  unsigned char digest[32];
  EVP_MD_CTX* mdCtx = EVP_MD_CTX_new();
  bool ok = mdCtx != nullptr;
  ok = ok && EVP_DigestInit_ex(mdCtx, EVP_sha256(), nullptr) == 1;
  ok = ok && EVP_DigestUpdate(mdCtx, spkiDer.data(), spkiDer.size()) == 1;
  unsigned int digestLen = 0;
  ok = ok && EVP_DigestFinal_ex(mdCtx, digest, &digestLen) == 1;
  EVP_MD_CTX_free(mdCtx);

  if (!ok || digestLen != 32) {
    Napi::Error::New(env, "SHA-256 computation failed").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  return Napi::String::New(env, Base64Encode(digest, 32));
}

// ---- Registration ----

void RegisterPinning(Napi::Env env, Napi::Object exports) {
  exports.Set("getPinsForDomain", Napi::Function::New(env, GetPinsForDomain));
  exports.Set("requiresPinning", Napi::Function::New(env, RequiresPinning));
  exports.Set("requiresPinningWithPort", Napi::Function::New(env, RequiresPinningWithPort));
  exports.Set("requiresPinningForUrl", Napi::Function::New(env, RequiresPinningForUrl));
  exports.Set("computeSpkiPin", Napi::Function::New(env, ComputeSpkiPin));
}

}  // namespace notely
