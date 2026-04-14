#pragma once
#include <napi.h>

namespace notely {

/**
 * Register certificate pinning N-API functions.
 *
 * Exposes: getPinsForDomain, requiresPinning, requiresPinningWithPort,
 *          requiresPinningForUrl, computeSpkiPin
 */
void RegisterPinning(Napi::Env env, Napi::Object exports);

}  // namespace notely
