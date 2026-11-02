package org.globalpoint.companion;

/** The embedded Node (src/main/jni/bridge.cpp). It can start only once per process. */
final class NodeBridge {
    static {
        System.loadLibrary("node");
        System.loadLibrary("companion-bridge");
    }

    private NodeBridge() {}

    /** Runs Node with these arguments (the first is the program name) until it exits; returns its exit code. */
    static native int startNode(String... arguments);
}
