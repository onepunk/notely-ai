#pragma once
#include <napi.h>

namespace notely {

/**
 * Register password crypto N-API functions.
 *
 * Exposes: encryptKeyWithPassword, decryptKeyWithPassword
 */
void RegisterPasswordCrypto(Napi::Env env, Napi::Object exports);

}  // namespace notely
