package org.example.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class RegisterRequest {
    @Email @NotBlank
    private String email;

    @NotBlank @Size(min = 8, max = 72)
    private String password;

    /** Name of the first device being registered */
    @NotBlank
    private String deviceName;

    private String platform = "unknown";
}
