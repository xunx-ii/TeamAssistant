cmake_minimum_required(VERSION 3.20)
project(teamassistant_backend LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(TEAMASSISTANT_USE_VENDOR_DEPS "Use sources from backend-cpp/deps when available" ON)

if (TEAMASSISTANT_USE_VENDOR_DEPS AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/deps/CMakeLists.txt")
  add_subdirectory(deps)
endif()

if (NOT TARGET Drogon::Drogon)
  find_package(Drogon CONFIG QUIET)
endif()

if (NOT TARGET Drogon::Drogon)
  if (TEAMASSISTANT_DEPS_DROGON_MESSAGE)
    message(FATAL_ERROR
      "Drogon is not available. ${TEAMASSISTANT_DEPS_DROGON_MESSAGE}")
  endif()

  message(FATAL_ERROR
    "Drogon is not available. Add Drogon sources under backend-cpp/deps/drogon "
    "or install a Drogon package discoverable by CMake.")
endif()

if (NOT TARGET SQLite::SQLite3)
  find_package(SQLite3 QUIET)
endif()

if (NOT TARGET SQLite::SQLite3)
  message(FATAL_ERROR
    "SQLite3 is not available. Add sqlite3.c/sqlite3.h under backend-cpp/deps/sqlite "
    "or install a SQLite3 package discoverable by CMake.")
endif()

if (NOT TARGET ZLIB::ZLIB)
  find_package(ZLIB QUIET)
endif()

if (NOT TARGET ZLIB::ZLIB)
  message(FATAL_ERROR
    "ZLIB is not available. Add zlib sources under backend-cpp/deps/zlib "
    "or install a ZLIB package discoverable by CMake.")
endif()

add_executable(teamassistant_backend
  src/main.cpp
)

add_executable(teamassistant_concurrency_bench
  tests/concurrency_bench.cpp
)

if (SQLite3_INCLUDE_DIRS)
  target_include_directories(teamassistant_backend PRIVATE
    ${SQLite3_INCLUDE_DIRS}
  )
endif()

target_link_libraries(teamassistant_backend PRIVATE
  Drogon::Drogon
  SQLite::SQLite3
  ZLIB::ZLIB
)

target_link_libraries(teamassistant_concurrency_bench PRIVATE
  Drogon::Drogon
)

if (MSVC)
  target_compile_options(teamassistant_backend PRIVATE /W4 /utf-8)
  target_compile_definitions(teamassistant_backend PRIVATE
    NOMINMAX
    WIN32_LEAN_AND_MEAN
    _CRT_SECURE_NO_WARNINGS
  )
  target_compile_options(teamassistant_concurrency_bench PRIVATE /W4 /utf-8)
  target_compile_definitions(teamassistant_concurrency_bench PRIVATE
    NOMINMAX
    WIN32_LEAN_AND_MEAN
    _CRT_SECURE_NO_WARNINGS
  )
else()
  target_compile_options(teamassistant_backend PRIVATE -Wall -Wextra -Wpedantic)
  target_compile_options(teamassistant_concurrency_bench PRIVATE -Wall -Wextra -Wpedantic)
endif()
