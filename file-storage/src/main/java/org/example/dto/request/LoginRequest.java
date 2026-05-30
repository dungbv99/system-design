package org.example.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class LoginRequest {
    @Email @NotBlank
    private String email;

    @NotBlank
    private String password;

    /** Optional: register this device during login */
    private String deviceName;
    private String platform;
}
