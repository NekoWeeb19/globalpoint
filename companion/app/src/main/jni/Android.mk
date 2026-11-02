LOCAL_PATH := $(call my-dir)

# libnode.so from the nodejs-mobile Android release (NODEJS_MOBILE_DIR is passed by app/build.gradle)
include $(CLEAR_VARS)
LOCAL_MODULE := node
LOCAL_SRC_FILES := $(NODEJS_MOBILE_DIR)/bin/$(TARGET_ARCH_ABI)/libnode.so
include $(PREBUILT_SHARED_LIBRARY)

# the JNI bridge that starts Node
include $(CLEAR_VARS)
LOCAL_MODULE := companion-bridge
LOCAL_SRC_FILES := bridge.cpp
LOCAL_C_INCLUDES := $(NODEJS_MOBILE_DIR)/include/node
LOCAL_CPPFLAGS := -std=c++20
LOCAL_SHARED_LIBRARIES := node
LOCAL_LDLIBS := -llog
include $(BUILD_SHARED_LIBRARY)
