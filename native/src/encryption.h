#pragma once
#include <napi.h>

namespace notely {

/**
 * Register encryption-related N-API functions.
 *
 * Exposes: encryptAesGcm, decryptAesGcm, deriveKeyFromPassword,
 *          generateHash, generateHmac, secureCompare, randomBytes, generateId
 */
void RegisterEncryption(Napi::Env env, Napi::Object exports);

}  // namespace notely
