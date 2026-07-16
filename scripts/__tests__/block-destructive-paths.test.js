const { spawnSync } = require("child_process");
const path = require("path");

const HOOK = path.resolve(__dirname, "..", "block-destructive-paths.sh");

// Run the hook with a Bash tool_input.command payload. Returns exit status
// (0 = allow, 2 = deny) and stderr (the deny reason, when blocked).
function runHook(command) {
  const result = spawnSync("bash", [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
  });
  return {
    status: result.status,
    stderr: result.stderr || "",
  };
}

function runPayload(payload) {
  const result = spawnSync("bash", [HOOK], {
    input: payload,
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr || "" };
}

describe("block-destructive-paths hook", () => {
  describe("Rule 4: redirect truncate vs append", () => {
    // The core behavior this PR introduces: truncating redirects (`>`) to
    // personal config/project paths are blocked, but appends (`>>`) are allowed
    // because an append cannot wipe a file.
    it("blocks truncating a personal dotfile with single >", () => {
      const { status, stderr } = runHook("echo x > /Users/brett/.env");
      expect(status).toBe(2);
      expect(stderr).toMatch(/TRUNCATES/);
    });

    it("blocks truncating a personal project path with single >", () => {
      const { status } = runHook("echo x > /Users/brett/Projects/foo");
      expect(status).toBe(2);
    });

    it("allows appending to a personal dotfile with >>", () => {
      const { status } = runHook("echo x >> /Users/brett/.env");
      expect(status).toBe(0);
    });

    it("allows appending to a personal project path with >>", () => {
      const { status } = runHook("echo x >> /Users/brett/Projects/foo/log");
      expect(status).toBe(0);
    });

    it("allows appending with no space between >> and path", () => {
      const { status } = runHook("echo x >>/Users/brett/.env");
      expect(status).toBe(0);
    });

    it("blocks the clobber operator >| which also truncates", () => {
      // `>|` forces truncation even under `set -o noclobber` — as destructive
      // as a bare `>`, so it must be blocked, not slip past the append carve-out.
      const { status } = runHook("echo x >| /Users/brett/.env");
      expect(status).toBe(2);
    });

    it("blocks clobber with no space: >|path", () => {
      const { status } = runHook("echo x >|/Users/brett/Projects/foo");
      expect(status).toBe(2);
    });

    // The hook inspects the raw, pre-expansion command string, so quoted and
    // home-syntax targets must be caught too — otherwise `> "…"`, `> ~/.env`,
    // or `> $HOME/.env` would silently truncate the very files this protects.
    it("blocks double-quoted absolute truncate", () => {
      const { status } = runHook('echo x > "/Users/brett/.env"');
      expect(status).toBe(2);
    });

    it("blocks single-quoted absolute truncate", () => {
      const { status } = runHook("echo x > '/Users/brett/.env'");
      expect(status).toBe(2);
    });

    it('blocks an fd-numbered quoted truncate (2>"...")', () => {
      const { status } = runHook('echo x 2>"/Users/brett/.env"');
      expect(status).toBe(2);
    });

    it("blocks a tilde dotfile truncate", () => {
      const { status } = runHook("echo x > ~/.env");
      expect(status).toBe(2);
    });

    it("blocks a $HOME dotfile truncate", () => {
      const { status } = runHook("echo x > $HOME/.env");
      expect(status).toBe(2);
    });

    it("blocks a ${HOME} dotfile truncate", () => {
      const { status } = runHook("echo x > ${HOME}/.env");
      expect(status).toBe(2);
    });

    it("blocks a tilde Projects truncate", () => {
      const { status } = runHook("echo x > ~/Projects/foo");
      expect(status).toBe(2);
    });

    it("blocks an uppercase-extension dotfile truncate (.Foo)", () => {
      const { status } = runHook("echo x > /Users/brett/.Foo");
      expect(status).toBe(2);
    });

    it("allows a quoted append to a personal dotfile", () => {
      const { status } = runHook('echo x >> "/Users/brett/.env"');
      expect(status).toBe(0);
    });

    it("allows a tilde append to a personal dotfile", () => {
      const { status } = runHook("echo x >> ~/.env");
      expect(status).toBe(0);
    });

    it("does not block redirects to non-personal paths", () => {
      const { status } = runHook("echo x > /tmp/scratch");
      expect(status).toBe(0);
    });

    it("does not block a tilde path to a NON-personal target", () => {
      // ~/notes is neither a dotfile nor under Projects — must stay allowed,
      // so the widened guard does not over-block ordinary home-dir writes.
      const { status } = runHook("echo x > ~/notes");
      expect(status).toBe(0);
    });

    // Split-quote concatenation: Bash joins adjacent quoted/unquoted word
    // parts before opening the redirect target, so these truncate the same
    // protected files. The hook strips quotes before matching to catch them.
    it("blocks a split-quoted $HOME dotfile truncate", () => {
      const { status } = runHook('echo x > "$HOME"/.env');
      expect(status).toBe(2);
    });

    it("blocks a split-quoted ${HOME} dotfile truncate", () => {
      const { status } = runHook('echo x > "${HOME}"/.env');
      expect(status).toBe(2);
    });

    it("blocks a split-quoted dotfile name truncate", () => {
      const { status } = runHook('echo x > /Users/brett/".env"');
      expect(status).toBe(2);
    });

    it("blocks a split-quoted Projects segment truncate", () => {
      const { status } = runHook('echo x > ~/"Projects"/foo');
      expect(status).toBe(2);
    });

    // >& and &> truncate stdout (and stderr) to the target — destructive.
    it("blocks the >& truncating redirect to a personal dotfile", () => {
      const { status } = runHook("echo x >& /Users/brett/.env");
      expect(status).toBe(2);
    });

    it("blocks the &> both-streams truncate to a personal dotfile", () => {
      const { status } = runHook("echo x &> /Users/brett/.env");
      expect(status).toBe(2);
    });

    // Boundary: sibling names that merely share the 'Projects' prefix are NOT
    // under the Projects tree and must stay allowed (no false-positive block).
    it("does not over-block a Projects2 sibling path", () => {
      const { status } = runHook("echo x > ~/Projects2/file");
      expect(status).toBe(0);
    });

    it("does not over-block a Projects-old sibling path", () => {
      const { status } = runHook("echo x > $HOME/Projects-old/file");
      expect(status).toBe(0);
    });

    // Real config dotfiles contain underscores, digits, and extra dots — the
    // guard must protect the whole dot-prefixed segment, not just letter-only
    // names, or high-value files like ~/.bash_profile silently truncate.
    it("blocks truncating ~/.bash_profile (underscore)", () => {
      const { status } = runHook("echo x > ~/.bash_profile");
      expect(status).toBe(2);
    });

    it("blocks truncating ~/.env.local (multi-dot)", () => {
      const { status } = runHook("echo x > ~/.env.local");
      expect(status).toBe(2);
    });

    it("blocks truncating ~/.p10k.zsh", () => {
      const { status } = runHook("echo x > ~/.p10k.zsh");
      expect(status).toBe(2);
    });

    it("blocks truncating a digit-containing dotfile", () => {
      const { status } = runHook("echo x > /Users/brett/.foo2bar");
      expect(status).toBe(2);
    });

    it("allows appending to ~/.bash_profile", () => {
      const { status } = runHook("echo x >> ~/.bash_profile");
      expect(status).toBe(0);
    });

    // The shell collapses repeated slashes, so any doubled-slash variant
    // resolves to the same protected file. The hook normalizes '/+' → '/'
    // before matching, closing the whole class regardless of slash position.
    it("blocks a double-slash tilde dotfile truncate", () => {
      const { status } = runHook("echo x > ~//.env");
      expect(status).toBe(2);
    });

    it("blocks a double-slash-after-username dotfile truncate", () => {
      const { status } = runHook("echo x > /Users/brett//.env");
      expect(status).toBe(2);
    });

    it("blocks a double-slash-before-username dotfile truncate", () => {
      const { status } = runHook("echo x > /Users//brett/.env");
      expect(status).toBe(2);
    });

    it("blocks a double-slash Projects truncate", () => {
      const { status } = runHook("echo x > /Users/brett//Projects/foo");
      expect(status).toBe(2);
    });

    it("blocks a triple-slash-everywhere dotfile truncate", () => {
      const { status } = runHook("echo x > /Users///brett///.env");
      expect(status).toBe(2);
    });

    // Shell literal quoting/escaping forms that still name the path literally:
    // ANSI-C $'...' and per-character backslash escapes. The normalizer strips
    // quotes, backslashes, and a leading '$' before a path char to catch them.
    it("blocks an ANSI-C $'...' quoted truncate", () => {
      const { status } = runHook("echo x > $'/Users/brett/.env'");
      expect(status).toBe(2);
    });

    it("blocks a backslash-escaped dotfile truncate", () => {
      const { status } = runHook("echo x > /Users/brett/\\.env");
      expect(status).toBe(2);
    });

    it("blocks a backslash-escaped Projects truncate", () => {
      const { status } = runHook("echo x > /Users/brett/\\Projects/foo");
      expect(status).toBe(2);
    });

    // Regression: the '$'-stripping normalization must NOT break $HOME/${HOME}
    // matching (only a '$' before ~ / . is dropped, not before a letter/brace).
    it("still blocks a $HOME dotfile truncate after normalization", () => {
      const { status } = runHook("echo x > $HOME/.bash_profile");
      expect(status).toBe(2);
    });
  });

  describe("preserved rm -rf guards (regression fence)", () => {
    // These lock in the incident protections the PR explicitly preserves.
    it("blocks rm -rf on a shell-substituted target", () => {
      const { status } = runHook('rm -rf "$(dirname "$VAR")"');
      expect(status).toBe(2);
    });

    it("allows rm -f on a variable file target", () => {
      const { status } = runHook('rm -f "$FILE"');
      expect(status).toBe(0);
    });

    it("allows rm -r without force on a variable directory target", () => {
      const { status } = runHook('rm -r "$DIR"');
      expect(status).toBe(0);
    });

    it("blocks rm -rf $HOME", () => {
      const { status } = runHook("rm -rf $HOME");
      expect(status).toBe(2);
    });

    it("blocks long-form recursive forced removal", () => {
      const { status } = runHook('rm --recursive --force "$HOME"');
      expect(status).toBe(2);
    });

    it("blocks rm -rf ~/Projects/internal", () => {
      const { status } = runHook("rm -rf ~/Projects/internal");
      expect(status).toBe(2);
    });

    it("blocks rm -rf on a Linux home directory", () => {
      const { status } = runHook("rm -rf /home/alice");
      expect(status).toBe(2);
    });

    it("blocks deleting the contents of the filesystem root", () => {
      const { status } = runHook("rm -rf /*");
      expect(status).toBe(2);
    });

    it("blocks deleting every child of a protected Projects root", () => {
      const { status } = runHook("rm -rf ~/Projects/*");
      expect(status).toBe(2);
    });

    it("blocks uppercase recursive flags", () => {
      const { status } = runHook('rm -Rf "$HOME"');
      expect(status).toBe(2);
    });

    it.each(["/bin/rm", "command rm", "env rm", "sudo rm"])(
      "blocks a protected target through %s",
      (invocation) => {
        const { status } = runHook(`${invocation} -rf "$HOME"`);
        expect(status).toBe(2);
      },
    );

    it("fails closed on malformed hook JSON", () => {
      const { status, stderr } = runPayload('{"tool_input":{"command":"rm');
      expect(status).toBe(2);
      expect(stderr).toMatch(/invalid JSON/);
    });

    it("blocks trap with embedded rm -rf", () => {
      const { status } = runHook("trap 'rm -rf /tmp/x' EXIT");
      expect(status).toBe(2);
    });

    it("allows a trap that removes one temporary file", () => {
      const { status } = runHook(`trap 'rm -f "$TMPFILE"' EXIT`);
      expect(status).toBe(0);
    });

    it("allows rm -rf on a concrete per-project path", () => {
      const { status } = runHook(
        "rm -rf /Users/brett/Projects/internal/my-repo/dist",
      );
      expect(status).toBe(0);
    });
  });

  describe("find deletion guards", () => {
    it("blocks a quoted dynamic root", () => {
      const { status } = runHook('find "$DIR" -type f -delete');
      expect(status).toBe(2);
    });

    it("allows a concrete build directory under a user project", () => {
      const { status } = runHook(
        "find /Users/alice/Projects/repo/build -type f -delete",
      );
      expect(status).toBe(0);
    });

    it("blocks a top-level user directory", () => {
      const { status } = runHook("find /Users/alice -type f -delete");
      expect(status).toBe(2);
    });
  });
});
