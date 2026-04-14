/**
 * Notely Native Addon - N-API Module Entry Point
 *
 * Registers all native modules:
 * - Encryption (AES-GCM, PBKDF2, hashing, HMAC)
 * - Certificate Pinning (SPKI pins, domain matching)
 * - Password Crypto (key encryption/decryption)
 * - License Verification (JWT RS256)
 */

#include <napi.h>

#include "encryption.h"
#include "pinning.h"
#include "password_crypto.h"
#include "license_verify.h"

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  notely::RegisterEncryption(env, exports);
  notely::RegisterPinning(env, exports);
  notely::RegisterPasswordCrypto(env, exports);
  notely::RegisterLicenseVerify(env, exports);
  return exports;
}

NODE_API_MODULE(notely_native, Init)
