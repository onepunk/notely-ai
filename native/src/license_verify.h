#pragma once
#include <napi.h>

namespace notely {

/**
 * Register license verification N-API functions.
 *
 * Exposes: verifyLicenseJwt, parseLicenseKey
 */
void RegisterLicenseVerify(Napi::Env env, Napi::Object exports);

}  // namespace notely
