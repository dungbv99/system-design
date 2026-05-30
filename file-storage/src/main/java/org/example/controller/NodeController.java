package org.example.controller;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.example.dto.request.CreateFolderRequest;
import org.example.dto.request.MoveNodeRequest;
import org.example.dto.response.NodeResponse;
import org.example.security.UserPrincipal;
import org.example.service.NodeService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * File/folder tree CRUD.
 *
 * GET  /api/nodes              → list root
 * GET  /api/nodes/{id}         → get node
 * GET  /api/nodes/{id}/children → list children
 * POST /api/nodes/folder        → create folder
 * PATCH /api/nodes/{id}         → rename / move
 * DELETE /api/nodes/{id}        → soft-delete
 */
@RestController
@RequestMapping("/api/nodes")
@RequiredArgsConstructor
public class NodeController {

    private final NodeService nodeService;

    @GetMapping
    public List<NodeResponse> listRoot(@AuthenticationPrincipal UserPrincipal principal) {
        return nodeService.listRoot(principal.getId());
    }

    @GetMapping("/{id}")
    public NodeResponse getNode(@AuthenticationPrincipal UserPrincipal principal,
                                @PathVariable String id) {
        return nodeService.getNode(principal.getId(), id);
    }

    @GetMapping("/{id}/children")
    public List<NodeResponse> listChildren(@AuthenticationPrincipal UserPrincipal principal,
                                           @PathVariable String id) {
        return nodeService.listChildren(principal.getId(), id);
    }

    @PostMapping("/folder")
    public ResponseEntity<NodeResponse> createFolder(
            @AuthenticationPrincipal UserPrincipal principal,
            @Valid @RequestBody CreateFolderRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(nodeService.createFolder(principal.getId(), req));
    }

    @PatchMapping("/{id}")
    public NodeResponse moveOrRename(@AuthenticationPrincipal UserPrincipal principal,
                                     @PathVariable String id,
                                     @RequestBody MoveNodeRequest req) {
        return nodeService.moveOrRename(principal.getId(), id, req);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteNode(@AuthenticationPrincipal UserPrincipal principal,
                                           @PathVariable String id) {
        nodeService.deleteNode(principal.getId(), id);
        return ResponseEntity.noContent().build();
    }
}
