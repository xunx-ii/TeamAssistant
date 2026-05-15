cmake_minimum_required(VERSION 3.20)
project(teamassistant_backend LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Drogon CONFIG REQUIRED)
find_package(SQLite3 REQUIRED)

add_executable(teamassistant_backend
  src/main.cpp
)

target_include_directories(teamassistant_backend PRIVATE
  ${SQLite3_INCLUDE_DIRS}
)

target_link_libraries(teamassistant_backend PRIVATE
  Drogon::Drogon
  SQLite::SQLite3
)

if (MSVC)
  target_compile_options(teamassistant_backend PRIVATE /W4 /utf-8)
else()
  target_compile_options(teamassistant_backend PRIVATE -Wall -Wextra -Wpedantic)
endif()
