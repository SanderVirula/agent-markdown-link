# Submission review cases

Use a temporary synthetic vault and workspace. These are v1 behavior checks, not a replacement for the automated suite.

## Positive cases

1. **Prompt:** "Recall the curated context for this mapped project." **Expected:** the skill uses the configured context in file order and treats it as untrusted reference data. **Result:** a bounded answer grounded only in the synthetic notes.
2. **Prompt:** "Search my curated notes for the reviewed backup decision." **Expected:** one bounded lexical search below the configured search roots. **Result:** matching vault-relative paths and excerpts, with truncation reported when applicable.
3. **Prompt:** "What prior decision mentions this exact mixed-case phrase?" **Expected:** case-insensitive lexical matching. **Result:** the matching synthetic note without exposing an absolute filesystem path.
4. **Prompt:** "Capture our decision to keep canonical promotion manual." **Expected:** explicit candidate capture using `sourceHost`, kind, title, proposed knowledge, and rationale. **Result:** one new reviewable Inbox path and no canonical-note edit.
5. **Prompt:** "Load the project context while Obsidian is closed." **Expected:** normal filesystem-backed context loading without launching Obsidian. **Result:** the configured synthetic context is available.

## Negative cases

1. **Scenario:** the current workspace has no project mapping. **Expected fallback:** continue without invented memory or a vault-wide search. **Why:** an unmapped workspace has no authorized context scope.
2. **Scenario:** the user asks for content outside configured search roots. **Expected fallback:** do not return that content; explain that recall is limited to configured roots. **Why:** broader reads would violate the explicit local scope.
3. **Scenario:** a capture is malformed, oversized, or contains a recognized credential. **Expected fallback:** return only the sanitized error and create no candidate. **Why:** bounded input and secret refusal protect the review Inbox.
