package org.example.service;

import lombok.RequiredArgsConstructor;
import org.example.dto.request.LoginRequest;
import org.example.dto.request.RegisterRequest;
import org.example.dto.response.AuthResponse;
import org.example.exception.AppException;
import org.example.model.Device;
import org.example.model.User;
import org.example.repository.DeviceRepository;
import org.example.repository.FileNodeRepository;
import org.example.repository.UserRepository;
import org.example.security.JwtTokenProvider;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepo;
    private final DeviceRepository deviceRepo;
    private final FileNodeRepository nodeRepo;
    private final JwtTokenProvider jwtProvider;
    private final PasswordEncoder passwordEncoder;

    @Transactional
    public AuthResponse register(RegisterRequest req) {
        if (userRepo.existsByEmail(req.getEmail())) {
            throw new AppException(HttpStatus.CONFLICT, "Email already registered");
        }

        User user = new User();
        user.setEmail(req.getEmail());
        user.setPasswordHash(passwordEncoder.encode(req.getPassword()));
        user = userRepo.save(user);

        Device device = createDevice(user.getId(), req.getDeviceName(), req.getPlatform());

        String token = jwtProvider.generateToken(user.getId());
        return buildResponse(user, device, token);
    }

    @Transactional
    public AuthResponse login(LoginRequest req) {
        User user = userRepo.findByEmail(req.getEmail())
                .orElseThrow(() -> new AppException(HttpStatus.UNAUTHORIZED, "Invalid credentials"));

        if (!passwordEncoder.matches(req.getPassword(), user.getPasswordHash())) {
            throw new AppException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
        }

        // Register device if provided, else return first device
        Device device;
        if (req.getDeviceName() != null) {
            device = createDevice(user.getId(), req.getDeviceName(),
                    req.getPlatform() != null ? req.getPlatform() : "unknown");
        } else {
            device = deviceRepo.findByUserId(user.getId()).stream().findFirst()
                    .orElseGet(() -> createDevice(user.getId(), "primary", "unknown"));
        }

        String token = jwtProvider.generateToken(user.getId());
        return buildResponse(user, device, token);
    }

    @Transactional
    public Device registerDevice(String userId, String name, String platform) {
        userRepo.findById(userId)
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "User not found"));
        return createDevice(userId, name, platform);
    }

    // ----------------------------------------------------------------

    private Device createDevice(String userId, String name, String platform) {
        Device d = new Device();
        d.setUserId(userId);
        d.setName(name);
        d.setPlatform(platform != null ? platform : "unknown");
        return deviceRepo.save(d);
    }

    private AuthResponse buildResponse(User user, Device device, String token) {
        long usedBytes = nodeRepo.sumBytesUsedByUser(user.getId());
        return AuthResponse.builder()
                .token(token)
                .userId(user.getId())
                .email(user.getEmail())
                .deviceId(device.getId())
                .quotaBytes(user.getQuotaBytes())
                .usedBytes(usedBytes)
                .build();
    }
}
