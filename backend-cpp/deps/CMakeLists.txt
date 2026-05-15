cmake_minimum_required(VERSION 3.20)
project(teamassistant_deps LANGUAGES C CXX)

function(teamassistant_force_bool name value)
  set(${name} ${value} CACHE BOOL "Configured by TeamAssistant vendored dependency build" FORCE)
endfunction()

set(TEAMASSISTANT_DEPS_DROGON_MESSAGE "" CACHE INTERNAL "")

if (EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/sqlite/sqlite3.c")
  add_library(teamassistant_sqlite3 STATIC
    "${CMAKE_CURRENT_SOURCE_DIR}/sqlite/sqlite3.c"
  )
  add_library(SQLite::SQLite3 ALIAS teamassistant_sqlite3)

  target_include_directories(teamassistant_sqlite3 PUBLIC
    "${CMAKE_CURRENT_SOURCE_DIR}/sqlite"
  )

  target_compile_definitions(teamassistant_sqlite3 PUBLIC
    SQLITE_THREADSAFE=1
    SQLITE_OMIT_LOAD_EXTENSION
  )

  if (MSVC)
    target_compile_options(teamassistant_sqlite3 PRIVATE /wd4244 /wd4267 /wd4996)
  endif()
endif()

if (EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/drogon/CMakeLists.txt")
  teamassistant_force_bool(BUILD_CTL OFF)
  teamassistant_force_bool(BUILD_EXAMPLES OFF)
  teamassistant_force_bool(BUILD_TESTING OFF)
  teamassistant_force_bool(BUILD_ORM OFF)
  teamassistant_force_bool(BUILD_BROTLI OFF)
  teamassistant_force_bool(BUILD_YAML_CONFIG OFF)
  teamassistant_force_bool(BUILD_SHARED_LIBS OFF)

  if (EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/drogon/trantor/CMakeLists.txt")
    teamassistant_force_bool(USE_SUBMODULE ON)
    add_subdirectory(drogon EXCLUDE_FROM_ALL)
  else()
    find_package(Trantor CONFIG QUIET)

    if (Trantor_FOUND)
      teamassistant_force_bool(USE_SUBMODULE OFF)
      add_subdirectory(drogon EXCLUDE_FROM_ALL)
    else()
      set(TEAMASSISTANT_DEPS_DROGON_MESSAGE
        [=[Found backend-cpp/deps/drogon, but backend-cpp/deps/drogon/trantor is missing its CMakeLists.txt. Fill the Drogon trantor submodule source or install Trantor so Drogon can be built.]=]
        CACHE INTERNAL "")
    endif()
  endif()
endif()
