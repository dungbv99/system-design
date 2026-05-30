package org.example.websocket;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.example.security.JwtTokenProvider;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.net.URI;
import java.util.Arrays;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * WebSocket handler for real-time sync push.
 *
 * Connect: ws://localhost:8080/api/sync/ws?token={jwt}
 *
 * On connection: authenticated via JWT query param.
 * Server pushes ChangeLog events as JSON text frames whenever the user's
 * files change (uploaded by any device).
 *
 * Clients can also send {"type":"ping"} for keep-alive.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SyncWebSocketHandler extends TextWebSocketHandler {

    private final JwtTokenProvider jwtProvider;
    private final ConnectionManager connectionManager;

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String token = extractToken(session);
        if (!StringUtils.hasText(token) || !jwtProvider.validateToken(token)) {
            log.warn("WS rejected: invalid or missing token (session={})", session.getId());
            session.close(CloseStatus.NOT_ACCEPTABLE.withReason("Invalid token"));
            return;
        }
        String userId = jwtProvider.getUserIdFromToken(token);
        connectionManager.register(userId, session);

        // Acknowledge connection
        session.sendMessage(new TextMessage(
                "{\"type\":\"connected\",\"userId\":\"" + userId + "\"}"));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        // Simple ping/pong — clients send {"type":"ping"} to keep connection alive
        String payload = message.getPayload().trim();
        if (payload.contains("\"ping\"")) {
            session.sendMessage(new TextMessage("{\"type\":\"pong\"}"));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        connectionManager.remove(session);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable ex) {
        log.warn("WS transport error (session={}): {}", session.getId(), ex.getMessage());
        connectionManager.remove(session);
    }

    // ----------------------------------------------------------------

    private String extractToken(WebSocketSession session) {
        URI uri = session.getUri();
        if (uri == null) return null;
        String query = uri.getQuery();
        if (!StringUtils.hasText(query)) return null;

        return Arrays.stream(query.split("&"))
                .map(p -> p.split("=", 2))
                .filter(kv -> kv.length == 2 && "token".equals(kv[0]))
                .map(kv -> kv[1])
                .findFirst()
                .orElse(null);
    }
}
