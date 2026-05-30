package org.example.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.example.dto.request.CreateShareRequest;
import org.example.dto.response.ShareResponse;
import org.example.security.UserPrincipal;
import org.example.service.ShareService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Sharing API.
 *
 * POST   /api/shares                   → create user or link share
 * GET    /api/shares                   → list shares I've created
 * GET    /api/shares/received          → list shares shared with me
 * DELETE /api/shares/{shareId}         → revoke
 * GET    /api/shares/link/{token}      → access node via public link (no auth)
 */
@RestController
@RequestMapping("/api/shares")
@RequiredArgsConstructor
public class ShareController {

    private final ShareService shareService;

    @PostMapping
    public ResponseEntity<ShareResponse> create(
            @AuthenticationPrincipal UserPrincipal principal,
            @Valid @RequestBody CreateShareRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(shareService.createShare(principal.getId(), req));
    }

    @GetMapping
    public List<ShareResponse> myShares(@AuthenticationPrincipal UserPrincipal principal) {
        return shareService.listMyShares(principal.getId());
    }

    @GetMapping("/received")
    public List<ShareResponse> receivedShares(@AuthenticationPrincipal UserPrincipal principal) {
        return shareService.listReceivedShares(principal.getId());
    }

    @DeleteMapping("/{shareId}")
    public ResponseEntity<Void> revoke(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable String shareId) {
        shareService.revokeShare(principal.getId(), shareId);
        return ResponseEntity.noContent().build();
    }

    /** Public endpoint — no authentication required. */
    @GetMapping("/link/{token}")
    public ShareResponse accessByLink(@PathVariable String token) {
        return shareService.accessByToken(token);
    }
}
