package com.kingalex.kingpong;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/** Desktop harness for the production Android signaling core; no Android runtime. */
public final class LanDriver {
    public static void main(String[] args) throws Exception {
        LocalLan bridge = new LocalLan(text -> {
            synchronized (System.out) { System.out.println(text); System.out.flush(); }
        });
        try (BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = input.readLine()) != null) bridge.handle(line);
        } finally { bridge.close(); }
    }
}
