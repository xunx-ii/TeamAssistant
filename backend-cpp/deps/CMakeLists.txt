cmake_minimum_required(VERSION 3.20)
project(teamassistant_deps LANGUAGES C CXX)

function(teamassistant_force_bool name value)
  set(${name} ${value} CACHE BOOL "Configured by TeamAssistant vendored dependency build" FORCE)
endfunction()

set(TEAMASSISTANT_DEPS_DROGON_MESSAGE "" CACHE INTERNAL "")

teamassistant_force_bool(BUILD_SHARED_LIBS OFF)

set(_teamassistant_previous_skip_install_rules "${CMAKE_SKIP_INSTALL_RULES}")
set(CMAKE_SKIP_INSTALL_RULES TRUE)

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

if (EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/jsoncpp/CMakeLists.txt")
  teamassistant_force_bool(JSONCPP_WITH_TESTS OFF)
  teamassistant_force_bool(JSONCPP_WITH_POST_BUILD_UNITTEST OFF)
  teamassistant_force_bool(JSONCPP_WITH_PKGCONFIG_SUPPORT OFF)
  teamassistant_force_bool(JSONCPP_WITH_CMAKE_PACKAGE OFF)
  teamassistant_force_bool(JSONCPP_WITH_EXAMPLE OFF)
  teamassistant_force_bool(JSONCPP_WITH_INSTALL OFF)
  teamassistant_force_bool(JSONCPP_WITH_STRICT_ISO OFF)
  teamassistant_force_bool(BUILD_STATIC_LIBS ON)
  teamassistant_force_bool(BUILD_OBJECT_LIBS OFF)

  add_subdirectory(jsoncpp EXCLUDE_FROM_ALL)

  if (TARGET jsoncpp_static)
    set(JSONCPP_INCLUDE_DIRS "${CMAKE_CURRENT_SOURCE_DIR}/jsoncpp/include" CACHE PATH "Vendored JsonCpp include dir" FORCE)
    set(JSONCPP_LIBRARIES jsoncpp_static CACHE STRING "Vendored JsonCpp library target" FORCE)
  endif()
endif()

if (EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/zlib/CMakeLists.txt")
  teamassistant_force_bool(ZLIB_BUILD_TESTING OFF)
  teamassistant_force_bool(ZLIB_BUILD_SHARED OFF)
  teamassistant_force_bool(ZLIB_BUILD_STATIC ON)
  teamassistant_force_bool(ZLIB_INSTALL OFF)

  add_subdirectory(zlib EXCLUDE_FROM_ALL)

  if (TARGET zlibstatic)
    if (NOT TARGET ZLIB::ZLIB)
      add_library(ZLIB::ZLIB ALIAS zlibstatic)
    endif()

    set(ZLIB_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/zlib" CACHE PATH "Vendored zlib include dir" FORCE)
    set(ZLIB_LIBRARY zlibstatic CACHE STRING "Vendored zlib library target" FORCE)
    set(ZLIB_INCLUDE_DIRS "${ZLIB_INCLUDE_DIR}" CACHE STRING "Vendored zlib include dirs" FORCE)
    set(ZLIB_LIBRARIES ZLIB::ZLIB CACHE STRING "Vendored zlib library target" FORCE)
  endif()
endif()

if (EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/drogon/CMakeLists.txt")
  teamassistant_force_bool(BUILD_CTL OFF)
  teamassistant_force_bool(BUILD_EXAMPLES OFF)
  teamassistant_force_bool(BUILD_TESTING OFF)
  teamassistant_force_bool(BUILD_ORM OFF)
  teamassistant_force_bool(BUILD_BROTLI OFF)
  teamassistant_force_bool(BUILD_YAML_CONFIG OFF)

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

set(CMAKE_SKIP_INSTALL_RULES "${_teamassistant_previous_skip_install_rules}")
