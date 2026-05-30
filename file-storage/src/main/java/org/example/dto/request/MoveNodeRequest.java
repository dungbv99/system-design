package org.example.dto.request;

import lombok.Data;

@Data
public class MoveNodeRequest {
    /** New name (rename), or null to keep existing */
    private String name;
    /** New parent id (move), or unchanged sentinel "SAME" */
    private String parentId;
}
