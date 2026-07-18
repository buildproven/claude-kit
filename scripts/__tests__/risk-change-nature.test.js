const {
  classifyChangeNature,
  isDirectiveComment,
  isExecutablePromptSurface,
  patchIsCommentWhitespaceOnly,
  patchIsAdditiveOnly,
  isTestPath,
} = require("../risk-change-nature");

// ---------------------------------------------------------------------------
// Anti-drift lock. The whole reason risk-change-nature.js exists is that F1
// (core/scripts/risk-score.js) and F2 (scripts/risk-policy-gate.js) once kept
// their OWN copies of this classification logic and drifted. This test proves
// the shared classifier is convention-agnostic: called the F1 way (floorPaths
// array + plain mechanical rules) and the F2 way (naturePolicy-bound + dep-bump/
// generated-aware mechanical rules), it returns the SAME verdict on a shared
// fixture set. If someone re-forks the logic, one side will move and this fails.
// ---------------------------------------------------------------------------

// F1's glob matcher (globToRegExp-based), inlined so this test needs no cross-
// repo import and passes under `cd core && npm test` standalone.
function f1GlobToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}
function f1Matches(filepath, patterns) {
  return (patterns || []).some((p) => f1GlobToRegExp(p).test(filepath));
}

// F2's glob matcher (placeholder-swap based), inlined.
function f2Matches(filepath, patterns) {
  return patterns.some((pattern) => {
    const DOUBLE_STAR = "\0DSTAR\0";
    const SINGLE_STAR = "\0SSTAR\0";
    let rx = pattern.replace(/\*\*/g, DOUBLE_STAR).replace(/\*/g, SINGLE_STAR);
    rx = rx.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
    rx = rx
      .replace(new RegExp(DOUBLE_STAR.replace(/\0/g, "\\0"), "g"), ".*")
      .replace(new RegExp(SINGLE_STAR.replace(/\0/g, "\\0"), "g"), "[^/]*");
    try {
      return new RegExp("^" + rx + "$", "u").test(filepath);
    } catch {
      return false;
    }
  });
}

// The shared predicates that both mechanical rule sets rely on are imported at
// the top from the module under test (not re-implemented — that would defeat the
// point). F1's mechanical sub-rule set: tests + inert comments, never a floor file.
function f1FileIsMechanical(file, status, patch, floorPaths) {
  if (f1Matches(file, floorPaths)) return false;
  const testRuleAllowed = isTestPath(file);
  return (
    (testRuleAllowed && status === "A") ||
    (testRuleAllowed && patchIsAdditiveOnly(patch)) ||
    patchIsCommentWhitespaceOnly(file, patch)
  );
}

// F2's mechanical sub-rule set: adds generated-path + dep-version-bump rules,
// and refuses test-file rules on floor paths. On the shared fixtures below
// (none of which are dep manifests or generated paths) it must AGREE with F1.
function f2FileIsMechanical(file, status, patch, floorPaths) {
  const onFloorPath = f2Matches(file, floorPaths);
  const testRuleAllowed = isTestPath(file) && !onFloorPath;
  return (
    (testRuleAllowed && status === "A") ||
    (testRuleAllowed && patchIsAdditiveOnly(patch)) ||
    patchIsCommentWhitespaceOnly(file, patch)
  );
}

const FLOOR = ["**/licensing*.*", "**/auth/**"];

const classifyF1 = (descriptors) =>
  classifyChangeNature(descriptors, {
    floorPaths: FLOOR,
    matchesPattern: f1Matches,
    fileIsMechanical: f1FileIsMechanical,
  });

const classifyF2 = (descriptors) =>
  classifyChangeNature(descriptors, {
    floorPaths: FLOOR,
    matchesPattern: f2Matches,
    fileIsMechanical: f2FileIsMechanical,
  });

const d = (file, status, patch, isBinary = false) => ({
  file,
  status,
  isBinary,
  patch,
});

const FIXTURES = [
  {
    name: "comment-only JS edit → mechanical",
    descriptors: [d("lib/util.js", "M", "+// a note\n+\n")],
    expected: "mechanical",
  },
  {
    name: "real logic line → logic",
    descriptors: [d("lib/a.js", "M", "+if (x) doThing()")],
    expected: "logic",
  },
  {
    name: "new test file → mechanical",
    descriptors: [d("tests/new.test.js", "A", "+stuff")],
    expected: "mechanical",
  },
  {
    name: "nested prompt surface (x/commands/foo.md) comment-only → logic",
    descriptors: [d("pkg/commands/foo.md", "M", "+<!-- note -->")],
    expected: "logic",
  },
  {
    name: "__PURE__ annotation edit → logic (directive, not inert)",
    descriptors: [d("lib/a.js", "M", "+/* #__PURE__ */\n")],
    expected: "logic",
  },
];

describe("risk-change-nature — anti-drift F1-way vs F2-way parity", () => {
  for (const { name, descriptors, expected } of FIXTURES) {
    it(`agrees on: ${name}`, () => {
      const v1 = classifyF1(descriptors);
      const v2 = classifyF2(descriptors);
      expect(v1, `F1-way verdict for "${name}"`).toBe(expected);
      expect(v2, `F2-way verdict for "${name}"`).toBe(expected);
      expect(v1, "F1-way and F2-way must agree (no drift)").toBe(v2);
    });
  }
});

// Directly lock the two drift resolutions that were bugs waiting to happen.
describe("risk-change-nature — drift resolutions", () => {
  it("(a) __PURE__ is a directive comment (adopted F2's rule)", () => {
    expect(isDirectiveComment("/* #__PURE__ */")).toBe(true);
  });
  it("(b) isExecutablePromptSurface matches NESTED command/skill/agent dirs (adopted F1's rule)", () => {
    expect(isExecutablePromptSurface("pkg/commands/foo.md")).toBe(true);
    expect(isExecutablePromptSurface("a/b/skills/x/SKILL.md")).toBe(true);
    expect(isExecutablePromptSurface("agents/reviewer.md")).toBe(true);
    // still does not flag inert docs
    expect(isExecutablePromptSurface("docs/guide.md")).toBe(false);
  });
});
