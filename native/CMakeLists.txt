cmake_minimum_required(VERSION 3.15)
cmake_policy(SET CMP0091 NEW)

project(notely_native)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Use /MT (static runtime) on Windows for standalone deployment
if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

# cmake-js provides these via command-line defines
include_directories(${CMAKE_JS_INC})

# Find node-addon-api headers
execute_process(
  COMMAND node -p "require('node-addon-api').include"
  WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
  OUTPUT_VARIABLE NODE_ADDON_API_DIR
  OUTPUT_STRIP_TRAILING_WHITESPACE
)
string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
include_directories(${NODE_ADDON_API_DIR})

# OpenSSL - use Node.js bundled OpenSSL headers and libs
# cmake-js sets CMAKE_JS_INC which includes Node's openssl headers
# For linking, we use the system OpenSSL or Node's OpenSSL
#
# On Windows, prefer static OpenSSL to avoid requiring users to have OpenSSL DLLs
# installed on their system. Without this, the .node addon fails to load at runtime
# with a cryptic "Failed to load notely-native addon" error.
if(WIN32)
  set(OPENSSL_USE_STATIC_LIBS TRUE)
  set(OPENSSL_MSVC_STATIC_RT TRUE)
endif()
find_package(OpenSSL REQUIRED)

# nlohmann/json (header-only, for JWT parsing in Phase 4)
include(FetchContent)
FetchContent_Declare(
  json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(json)

# On Windows, generate node.lib import library from N-API .def file
# cmake-js passes CMAKE_JS_NODELIB_DEF and CMAKE_JS_NODELIB_TARGET but
# expects CMakeLists.txt to generate the .lib from the .def
if(MSVC AND CMAKE_JS_NODELIB_DEF AND CMAKE_JS_NODELIB_TARGET)
  execute_process(COMMAND ${CMAKE_AR} /def:${CMAKE_JS_NODELIB_DEF} /out:${CMAKE_JS_NODELIB_TARGET} ${CMAKE_STATIC_LINKER_FLAGS})
endif()

# Source files
set(SOURCES
  src/addon.cpp
  src/encryption.cpp
  src/pinning.cpp
  src/password_crypto.cpp
  src/license_verify.cpp
)

# Build the native addon
add_library(${PROJECT_NAME} SHARED ${SOURCES} ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

target_link_libraries(${PROJECT_NAME}
  ${CMAKE_JS_LIB}
  OpenSSL::SSL
  OpenSSL::Crypto
  nlohmann_json::nlohmann_json
)

# N-API version 8 for broad compatibility
target_compile_definitions(${PROJECT_NAME} PRIVATE
  NAPI_VERSION=8
  NAPI_DISABLE_CPP_EXCEPTIONS
)
