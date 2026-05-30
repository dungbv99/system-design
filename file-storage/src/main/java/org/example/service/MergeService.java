package org.example.service;

import org.springframework.stereotype.Service;

import java.util.*;

/**
 * 3-way text merge — diff3-style algorithm.
 *
 * Algorithm:
 *  1. LCS(base, ours)   → change hunks for "ours"
 *  2. LCS(base, theirs) → change hunks for "theirs"
 *  3. Walk base line-by-line:
 *     - both unchanged → emit base line
 *     - only one changed → emit that version's lines
 *     - both changed, same result → emit once (convergent edit)
 *     - both changed, different result → conflict block with markers
 *
 * Not a full production merge (no hunk overlap resolution across regions),
 * but handles the vast majority of real-world non-overlapping edits cleanly.
 */
@Service
public class MergeService {

    public record MergeResult(String content, boolean hasConflicts) {}

    // -----------------------------------------------------------------
    //  Public API
    // -----------------------------------------------------------------

    public MergeResult merge(String base, String ours, String theirs) {
        // Fast paths
        if (ours.equals(theirs))  return new MergeResult(ours, false);
        if (ours.equals(base))    return new MergeResult(theirs, false);
        if (theirs.equals(base))  return new MergeResult(ours, false);

        String[] bLines = lines(base);
        String[] oLines = lines(ours);
        String[] tLines = lines(theirs);

        // Build change maps: base-line-index → Hunk
        Map<Integer, Hunk> ourHunks   = buildHunks(bLines, oLines);
        Map<Integer, Hunk> theirHunks = buildHunks(bLines, tLines);

        StringBuilder sb = new StringBuilder();
        boolean conflict = false;
        int i = 0;

        while (i < bLines.length) {
            Hunk oh = ourHunks.get(i);
            Hunk th = theirHunks.get(i);

            if (oh == null && th == null) {
                // Both kept this base line
                sb.append(bLines[i]).append('\n');
                i++;
            } else if (oh != null && th == null) {
                // Only ours changed
                for (String l : oh.newLines) sb.append(l).append('\n');
                i = oh.baseEnd;
            } else if (th != null && oh == null) {
                // Only theirs changed
                for (String l : th.newLines) sb.append(l).append('\n');
                i = th.baseEnd;
            } else {
                // Both changed this region
                assert oh != null;
                if (Arrays.equals(oh.newLines, th.newLines)) {
                    // Identical edit from both sides — just emit once
                    for (String l : oh.newLines) sb.append(l).append('\n');
                } else {
                    // True conflict: emit conflict markers
                    conflict = true;
                    sb.append("<<<<<<< OURS\n");
                    for (String l : oh.newLines) sb.append(l).append('\n');
                    sb.append("=======\n");
                    for (String l : th.newLines) sb.append(l).append('\n');
                    sb.append(">>>>>>> THEIRS\n");
                }
                i = Math.max(oh.baseEnd, th.baseEnd);
            }
        }

        return new MergeResult(sb.toString(), conflict);
    }

    // -----------------------------------------------------------------
    //  Internals
    // -----------------------------------------------------------------

    private record Hunk(int baseStart, int baseEnd, String[] newLines) {}

    /**
     * Compute change hunks from {@code base} to {@code target} using LCS.
     * Returns a map keyed by the STARTING base-line index of each changed region.
     */
    private Map<Integer, Hunk> buildHunks(String[] base, String[] target) {
        // LCS table
        int m = base.length, n = target.length;
        int[][] dp = new int[m + 1][n + 1];
        for (int i = m - 1; i >= 0; i--) {
            for (int j = n - 1; j >= 0; j--) {
                if (base[i].equals(target[j])) {
                    dp[i][j] = dp[i + 1][j + 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
                }
            }
        }

        // Backtrack to produce edit script
        Map<Integer, Hunk> hunks = new LinkedHashMap<>();
        int i = 0, j = 0;
        while (i < m || j < n) {
            if (i < m && j < n && base[i].equals(target[j])) {
                i++; j++;   // equal — match
            } else {
                // Start of a changed region
                int bStart = i, tStart = j;
                // Consume all non-matching lines on both sides
                while (i < m || j < n) {
                    if (i < m && j < n && base[i].equals(target[j])) break;
                    if (j >= n || (i < m && dp[i + 1][j] >= dp[i][j + 1])) i++;
                    else j++;
                }
                String[] newLines = Arrays.copyOfRange(target, tStart, j);
                if (bStart < i || newLines.length > 0) {
                    hunks.put(bStart, new Hunk(bStart, i, newLines));
                }
            }
        }
        return hunks;
    }

    private String[] lines(String text) {
        if (text == null || text.isEmpty()) return new String[0];
        // Split but keep trailing empty string from final newline
        return text.split("\n", -1);
    }
}
