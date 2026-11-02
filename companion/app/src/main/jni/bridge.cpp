// Starts the embedded Node (nodejs-mobile's libnode.so) with the given arguments and sends its
// stdout/stderr to logcat (tag "node"). Node can start only once per process, so the app runs it in
// its own process (":node") and ends that process to stop the server.
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "node.h"

static int pipeOut[2], pipeErr[2];

static void* forward(void* arg) {
    int fd = *static_cast<int*>(arg);
    int priority = fd == pipeErr[0] ? ANDROID_LOG_WARN : ANDROID_LOG_INFO;
    char buffer[2048];
    ssize_t n;
    while ((n = read(fd, buffer, sizeof(buffer) - 1)) > 0) {
        if (buffer[n - 1] == '\n') n--;
        buffer[n] = 0;
        __android_log_write(priority, "node", buffer);
    }
    return nullptr;
}

static void redirectOutput() {
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    pipe(pipeOut);
    pipe(pipeErr);
    dup2(pipeOut[1], STDOUT_FILENO);
    dup2(pipeErr[1], STDERR_FILENO);
    pthread_t a, b;
    pthread_create(&a, nullptr, forward, &pipeOut[0]);
    pthread_create(&b, nullptr, forward, &pipeErr[0]);
    pthread_detach(a);
    pthread_detach(b);
}

extern "C" JNIEXPORT jint JNICALL
Java_org_globalpoint_companion_NodeBridge_startNode(JNIEnv* env, jclass, jobjectArray arguments) {
    // Node wants every argument in one block of memory
    jsize argc = env->GetArrayLength(arguments);
    std::vector<std::string> args;
    size_t total = 0;
    for (jsize i = 0; i < argc; i++) {
        auto s = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
        const char* chars = env->GetStringUTFChars(s, nullptr);
        args.emplace_back(chars);
        total += args.back().size() + 1;
        env->ReleaseStringUTFChars(s, chars);
        env->DeleteLocalRef(s);
    }
    char* block = static_cast<char*>(calloc(total, 1));
    std::vector<char*> argv;
    char* p = block;
    for (auto& a : args) {
        memcpy(p, a.c_str(), a.size());
        argv.push_back(p);
        p += a.size() + 1;
    }
    argv.push_back(nullptr);

    redirectOutput();
    return node::Start(static_cast<int>(argc), argv.data());
}
