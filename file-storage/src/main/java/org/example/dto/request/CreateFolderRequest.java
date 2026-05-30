package org.example.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class CreateFolderRequest {
    @NotBlank
    private String name;

    /** null = create at root */
    private String parentId;
}
