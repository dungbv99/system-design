package org.example.websocket;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.List;
import java.util.Map;

/**
 * In-memory registry of active WebSocket connections, keyed by userId.
 * Thread-safe: multiple devices per user supported.
 */
@Slf4j
@Component
public class ConnectionManager {

    /** userId → list of open sessions */
    private final Map<String, List<WebSocketSession>> sessions =
            new ConcurrentHashMap<>();

    /** sessionId → userId (for reverse lookup on disconnect) */
    private final Map<String, String> sessionOwner = new ConcurrentHashMap<>();

    public void register(String userId, WebSocketSession session) {
        sessions.computeIfAbsent(userId, k -> new CopyOnWriteArrayList<>()).add(session);
        sessionOwner.put(session.getId(), userId);
        log.debug("WS connected: user={} session={} total={}",
                userId, session.getId(), sessions.get(userId).size());
    }

    public void remove(WebSocketSession session) {
        String userId = sessionOwner.remove(session.getId());
        if (userId != null) {
            List<WebSocketSession> list = sessions.get(userId);
            if (list != null) {
                list.remove(session);
                if (list.isEmpty()) sessions.remove(userId);
            }
            log.debug("WS disconnected: user={} session={}", userId, session.getId());
        }
    }

    /**
     * Push a JSON message to all sessions belonging to {@code userId}.
     * Stale/closed sessions are cleaned up automatically.
     */
    public void broadcastAsync(String userId, String jsonMessage) {
        List<WebSocketSession> list = sessions.get(userId);
        if (list == null || list.isEmpty()) return;

        TextMessage msg = new TextMessage(jsonMessage);
        list.removeIf(session -> {
            if (!session.isOpen()) return true;
            try {
                synchronized (session) {
                    session.sendMessage(msg);
                }
                return false;
            } catch (Exception e) {
                log.warn("WS send failed for session {}: {}", session.getId(), e.getMessage());
                return true;  // remove dead session
            }
        });
    }

    public int connectedDeviceCount(String userId) {
        List<WebSocketSession> list = sessions.get(userId);
        return list != null ? list.size() : 0;
    }
}
