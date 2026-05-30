package org.example.controller;

import lombok.RequiredArgsConstructor;
import org.example.dto.response.VersionResponse;
import org.example.security.UserPrincipal;
import org.example.service.VersionService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Version history API.
 *
 * GET    /api/versions/{nodeId}              → list all versions (desc)
 * GET    /api/versions/{nodeId}/{version}    → get specific version metadata
 * POST   /api/versions/{nodeId}/{version}/restore → restore (creates new version)
 * DELETE /api/versions/{nodeId}/{version}    → delete old version (GC blocks)
 */
@RestController
@RequestMapping("/api/versions")
@RequiredArgsConstructor
public class VersionController {

    private final VersionService versionService;

    @GetMapping("/{nodeId}")
    public List<VersionResponse> listVersions(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable String nodeId) {
        return versionService.listVersions(principal.getId(), nodeId);
    }

    @GetMapping("/{nodeId}/{version}")
    public VersionResponse getVersion(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable String nodeId,
            @PathVariable int version) {
        return versionService.getVersion(principal.getId(), nodeId, version);
    }

    @PostMapping("/{nodeId}/{version}/restore")
    public VersionResponse restoreVersion(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable String nodeId,
            @PathVariable int version,
            @RequestParam(required = false) String deviceId) {
        return versionService.restoreVersion(principal.getId(), nodeId, version, deviceId);
    }

    @DeleteMapping("/{nodeId}/{version}")
    public ResponseEntity<Void> deleteVersion(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable String nodeId,
            @PathVariable int version) {
        versionService.deleteVersion(principal.getId(), nodeId, version);
        return ResponseEntity.noContent().build();
    }
}
