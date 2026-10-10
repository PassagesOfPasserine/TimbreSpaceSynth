cmake_minimum_required(VERSION 3.22)
project(TimbreSpaceSynth VERSION 0.1.0 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
option(TIMBRE_BUILD_PLUGIN "Build JUCE plugin and standalone" ON)
include(CTest)
if(BUILD_TESTING)
  add_executable(engine_tests Tests/EngineTests.cpp)
  target_include_directories(engine_tests PRIVATE Source)
  add_test(NAME engine_tests COMMAND engine_tests)
endif()
if(TIMBRE_BUILD_PLUGIN)
  set(JUCE_SOURCE_DIR "" CACHE PATH "Local JUCE 9.0.3 checkout (otherwise fetched)")
  if(JUCE_SOURCE_DIR)
    add_subdirectory("${JUCE_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/JUCE")
  else()
    include(FetchContent)
    FetchContent_Declare(JUCE GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
      GIT_TAG be29c81492b6151c8ea8d14c840e1311963b3a83)
    FetchContent_MakeAvailable(JUCE)
  endif()
  juce_add_plugin(TimbreSpaceSynth COMPANY_NAME "Passages of Passerine"
    BUNDLE_ID "com.passagesofpasserine.timbrespacesynth"
    PLUGIN_MANUFACTURER_CODE PsPr PLUGIN_CODE TmSp
    FORMATS VST3 Standalone PRODUCT_NAME "Timbre Space Synth"
    IS_SYNTH TRUE NEEDS_MIDI_INPUT TRUE NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE COPY_PLUGIN_AFTER_BUILD FALSE)
  if(BUILD_TESTING)
    add_executable(processor_tests Tests/ProcessorTests.cpp)
    target_include_directories(processor_tests PRIVATE Source $<TARGET_PROPERTY:TimbreSpaceSynth,INCLUDE_DIRECTORIES>)
    target_compile_definitions(processor_tests PRIVATE $<TARGET_PROPERTY:TimbreSpaceSynth,COMPILE_DEFINITIONS>)
    target_link_libraries(processor_tests PRIVATE TimbreSpaceSynth)
    add_test(NAME processor_tests COMMAND processor_tests)
  endif()
  juce_generate_juce_header(TimbreSpaceSynth)
  target_sources(TimbreSpaceSynth PRIVATE Source/PluginProcessor.cpp Source/PluginEditor.cpp)
  target_compile_definitions(TimbreSpaceSynth PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0)
  target_link_libraries(TimbreSpaceSynth PRIVATE juce::juce_audio_utils juce::juce_dsp
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
endif()
