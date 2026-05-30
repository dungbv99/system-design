package org.example.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.example.dto.request.LoginRequest;
import org.example.dto.request.RegisterRequest;
import org.example.dto.response.AuthResponse;
import org.example.model.Device;
import org.example.security.UserPrincipal;
import org.example.service.AuthService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    /** Register a new account (+ first device). */
    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(authService.register(req));
    }

    /** Login and get a JWT token. */
    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest req) {
        return ResponseEntity.ok(authService.login(req));
    }

    /** Register an additional device for an already-authenticated user. */
    @PostMapping("/device")
    public ResponseEntity<Device> registerDevice(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestParam String name,
            @RequestParam(defaultValue = "unknown") String platform) {
        Device device = authService.registerDevice(principal.getId(), name, platform);
        return ResponseEntity.status(HttpStatus.CREATED).body(device);
    }
}
