# Changelog

All notable changes to claude-kit are documented here.

## Unreleased

### Added

- The revision-bound quality engine now supports opt-in Gemini review as a
  bounded, read-only primary or fallback provider. Gemini responses use the
  same strict structured-review schema, provider circuit, attempt governor,
  artifact inventory, and fail-closed merge evidence as Claude and Codex
  (#139).

## [5.0.0](https://github.com/buildproven/claude-kit/compare/claude-kit-v4.1.0...claude-kit-v5.0.0) (2026-08-01)


### ⚠ BREAKING CHANGES

* branch pruning is now opt-in (CLAUDE_KIT_AUTO_PRUNE=1), and editing on main is denied rather than auto-branched (CLAUDE_KIT_ALLOW_MAIN_EDITS=1 to restore).

### Features

* absorb 6 generic SWE agents + 2 dev-hygiene commands from pro (phase 2 step 4) ([#39](https://github.com/buildproven/claude-kit/issues/39)) ([a3ed514](https://github.com/buildproven/claude-kit/commit/a3ed5149dafaf22940b6d429b50e903c848344a2))
* add bounded overnight Ralph loop ([#88](https://github.com/buildproven/claude-kit/issues/88)) ([0e29e49](https://github.com/buildproven/claude-kit/commit/0e29e49bec9274d1c357f4cfcdb21acf731ac3db))
* add generic codex-parity and merge-train skills ([#146](https://github.com/buildproven/claude-kit/issues/146)) ([466e064](https://github.com/buildproven/claude-kit/commit/466e06412512ef85ded6549f196b7aa5dbabdac7))
* add provider-neutral Codex and fleet platform ([#95](https://github.com/buildproven/claude-kit/issues/95)) ([745506d](https://github.com/buildproven/claude-kit/commit/745506d3886209e938608504f5fb203b9b22fa2b))
* allow signed operator quality overrides ([c4fc8b6](https://github.com/buildproven/claude-kit/commit/c4fc8b6c4bdaa12078d2c5ced33695790263073e))
* **commands:** add /bs:prd command for the prd skill ([#221](https://github.com/buildproven/claude-kit/issues/221)) ([8862a89](https://github.com/buildproven/claude-kit/commit/8862a892fcc8732385b52c716661556bee2720cf))
* **csc-1:** claude-kit CSC-1 compliance + CI enforcement ([#52](https://github.com/buildproven/claude-kit/issues/52)) ([aae3bb7](https://github.com/buildproven/claude-kit/commit/aae3bb7789579f4753190c7190f8a58ebf0093dd))
* **dev:** merge inline-list fan-out + --alt into canonical dev skill ([#53](https://github.com/buildproven/claude-kit/issues/53)) ([6c44d5a](https://github.com/buildproven/claude-kit/commit/6c44d5a070020ce29f78f2abdada39b2a7d9dec5))
* **frontend-design:** add AI-ism denylist + mandatory self-review pass ([#54](https://github.com/buildproven/claude-kit/issues/54)) ([50f43c6](https://github.com/buildproven/claude-kit/commit/50f43c6013597dc6d7ff10b8e42232bf3ea2c1a7))
* harden OSS distribution for v3.2 ([#87](https://github.com/buildproven/claude-kit/issues/87)) ([620d5fa](https://github.com/buildproven/claude-kit/commit/620d5fa0fa666f6a946ff3e6a1e2cd9e0ed8a24f))
* initial public release of claude-kit v1.0.0 ([212f116](https://github.com/buildproven/claude-kit/commit/212f11665e8c94fb963c802804b41966ddcf26d8))
* **merge-train:** enforce shared batch review budget ([#158](https://github.com/buildproven/claude-kit/issues/158)) ([e0f9315](https://github.com/buildproven/claude-kit/commit/e0f9315d6a48c0fcf908a0a4f47c4404d20d1e91))
* **quality:** absorb pro's quality skill + healthcheck frontmatter (phase 1 collapse) ([#36](https://github.com/buildproven/claude-kit/issues/36)) ([79d4a22](https://github.com/buildproven/claude-kit/commit/79d4a22747d801b0248c1a35b5b88eedbf094ecf))
* **quality:** add governed Gemini reviewer ([#139](https://github.com/buildproven/claude-kit/issues/139)) ([ce7d578](https://github.com/buildproven/claude-kit/commit/ce7d578c6dbf5f1c713d2384007112bf6f484654))
* **quality:** add on-demand /bs:quality status command (BUI-383) ([#145](https://github.com/buildproven/claude-kit/issues/145)) ([0e240b1](https://github.com/buildproven/claude-kit/commit/0e240b1a343c9e4349cb6c79945aaa9271769708))
* **quality:** adversarial verification — make findings survive refutation, not agreement ([#81](https://github.com/buildproven/claude-kit/issues/81)) ([a548a81](https://github.com/buildproven/claude-kit/commit/a548a811d64b7bf16b55ebf9ae1d8f77a3a74374))
* **quality:** attribute review telemetry arms ([#157](https://github.com/buildproven/claude-kit/issues/157)) ([00c453a](https://github.com/buildproven/claude-kit/commit/00c453a68e1c429635677ced28bca990f369ca9c))
* **quality:** auto-select scope+level from diff size and risk tier ([#30](https://github.com/buildproven/claude-kit/issues/30)) ([725ef95](https://github.com/buildproven/claude-kit/commit/725ef955683f1c64f79e31df7a7086549e6c5dea))
* **quality:** campaign telemetry recorder (Wave 2.5, BUI-341) ([#115](https://github.com/buildproven/claude-kit/issues/115)) ([c9d73a6](https://github.com/buildproven/claude-kit/commit/c9d73a6440d5b9d74b3dae4e585f8f4a440989d9))
* **quality:** discover Python repository gates ([#161](https://github.com/buildproven/claude-kit/issues/161)) ([6b048a1](https://github.com/buildproven/claude-kit/commit/6b048a1b8bac615d176d0f8e4e505230e0cfa7f3))
* **quality:** document /goal completion condition for CI-mode loops ([#51](https://github.com/buildproven/claude-kit/issues/51)) ([d86172b](https://github.com/buildproven/claude-kit/commit/d86172be63a96b0fde16a5844c40a133a15eb092))
* **quality:** let an operator explicitly waive CI billing failures on protected repos ([#237](https://github.com/buildproven/claude-kit/issues/237)) ([008e865](https://github.com/buildproven/claude-kit/commit/008e8657e85ab53a682ebb80ba2b106d9f821a88))
* **quality:** make merge authority autonomous by default ([#156](https://github.com/buildproven/claude-kit/issues/156)) ([f5f954a](https://github.com/buildproven/claude-kit/commit/f5f954a1fddd74e9612c6182d4442319497d69c7))
* **quality:** provider-neutral quota-aware review ([#92](https://github.com/buildproven/claude-kit/issues/92)) ([0b3cd06](https://github.com/buildproven/claude-kit/commit/0b3cd063503b5c26279ad0a3880ddb1c53befde9))
* **quality:** repo-context-aware critical gate + always-human floor ([#128](https://github.com/buildproven/claude-kit/issues/128)) ([0cc52df](https://github.com/buildproven/claude-kit/commit/0cc52df3bfe70007f0a46692262c0e1013dcd30d))
* **quality:** require red-capable evidence for high risk ([#155](https://github.com/buildproven/claude-kit/issues/155)) ([8f15434](https://github.com/buildproven/claude-kit/commit/8f1543428c69f2fef9b6984e623295f2eb89baeb))
* **quality:** risk-scaled machine review depth (kit-native scorer) ([#59](https://github.com/buildproven/claude-kit/issues/59)) ([6c34e16](https://github.com/buildproven/claude-kit/commit/6c34e16e31d3abf13339c338c164690f2d7c799b))
* **quality:** route review depth by task type ([#133](https://github.com/buildproven/claude-kit/issues/133)) ([fedaee2](https://github.com/buildproven/claude-kit/commit/fedaee26b9048912d867e1bb1f4b61fadbbfd837))
* **quality:** route review effort on effectiveTier (change-nature) ([#55](https://github.com/buildproven/claude-kit/issues/55)) ([a944f7a](https://github.com/buildproven/claude-kit/commit/a944f7abc688ecfe1165d994fad6522a178874cf))
* **quality:** sign review evidence tuples ([#195](https://github.com/buildproven/claude-kit/issues/195)) ([1cb70bd](https://github.com/buildproven/claude-kit/commit/1cb70bdf804723112d2f364c06fa011a31790c6e))
* **quality:** support native repository gates ([#137](https://github.com/buildproven/claude-kit/issues/137)) ([2b5fd65](https://github.com/buildproven/claude-kit/commit/2b5fd6577c11b1fa559fd0eaa54f281d215dcee2))
* **quality:** synchronous subprocess review so --merge actually completes ([#64](https://github.com/buildproven/claude-kit/issues/64)) ([f7e2339](https://github.com/buildproven/claude-kit/commit/f7e23397ddf8bfeb4d2c462d6dbc482df79e3b7a))
* **scripts:** add inline-list-parser for /bs:dev and /bs:ralph fan-out ([#46](https://github.com/buildproven/claude-kit/issues/46)) ([024d397](https://github.com/buildproven/claude-kit/commit/024d397b6c2d691227995de55b1c172aa25c26f0))
* **scrub:** auto version bump + GitHub release in Phase 9 ([66c1d3d](https://github.com/buildproven/claude-kit/commit/66c1d3d78038c178bb7fb121d384f9b2006fb32d))
* **skills:** absorb basic-hygiene from pro — cost/deps/status/workflow + commands ([#37](https://github.com/buildproven/claude-kit/issues/37)) ([03c7897](https://github.com/buildproven/claude-kit/commit/03c789722d901d6558d863329eb202a54d13c215))
* **skills:** absorb sticky-funnel skills — frontend-design, ui-reviewer, webapp-testing, visualise ([#38](https://github.com/buildproven/claude-kit/issues/38)) ([8af8c06](https://github.com/buildproven/claude-kit/commit/8af8c065dff8a35855ce88e3d6b369f577a2ede7))
* strengthen engineering and UI design disciplines ([#105](https://github.com/buildproven/claude-kit/issues/105)) ([9ee5ff5](https://github.com/buildproven/claude-kit/commit/9ee5ff5b11ae243376f71527c1688d98a768ea90))
* tool-agnostic parity for Codex and Claude Code ([#121](https://github.com/buildproven/claude-kit/issues/121)) ([3f8e825](https://github.com/buildproven/claude-kit/commit/3f8e825bdf0fe03acfb6d9d6ed84e7e73b009df5))
* unify worktree lifecycle management ([#131](https://github.com/buildproven/claude-kit/issues/131)) ([afc6c11](https://github.com/buildproven/claude-kit/commit/afc6c11c8bc3f1dc0f6e1ba6b3a62a7d6e903f14))


### Bug Fixes

* **agents:** pin security-auditor, accessibility-tester, performance-engineer to opus ([#56](https://github.com/buildproven/claude-kit/issues/56)) ([7d6aea6](https://github.com/buildproven/claude-kit/commit/7d6aea6aa02bd94a91b68202fbd62b95fd0f4fe6))
* **agents:** unpin review agents from opus — inherit session model ([#57](https://github.com/buildproven/claude-kit/issues/57)) ([9938aba](https://github.com/buildproven/claude-kit/commit/9938aba1fa1f5d1216da869dc32c2a9b8f37c15a))
* align model routing with runtime policy ([#197](https://github.com/buildproven/claude-kit/issues/197)) ([d81a526](https://github.com/buildproven/claude-kit/commit/d81a526cbd6776ba511e4ebef3e74199d6320c5c))
* align SOTA scoring and public boundary ([#86](https://github.com/buildproven/claude-kit/issues/86)) ([a10756d](https://github.com/buildproven/claude-kit/commit/a10756df20f33191de969a52f97e1d74f4421cf7))
* **backlog:** close all cited Linear issues after merge ([#160](https://github.com/buildproven/claude-kit/issues/160)) ([effd8d7](https://github.com/buildproven/claude-kit/commit/effd8d7ded0bfcb37e73e1ab1619a84696039145))
* **backlog:** use native Linear merge automation ([#169](https://github.com/buildproven/claude-kit/issues/169)) ([36569ce](https://github.com/buildproven/claude-kit/commit/36569ce7ed4d1bfcd75987415e4d0255cf93d9ef))
* **ci:** unblock release-please with the automatic workflow token ([#239](https://github.com/buildproven/claude-kit/issues/239)) ([e01fe3c](https://github.com/buildproven/claude-kit/commit/e01fe3c398382cb4da733dd34974f7564314896d))
* clean merged PR worktrees after branch deletion ([#215](https://github.com/buildproven/claude-kit/issues/215)) ([91f9359](https://github.com/buildproven/claude-kit/commit/91f93594fdf07a2f0319b3aee5022677c7057250))
* complete ESLint 10 and Node 24 migration ([#93](https://github.com/buildproven/claude-kit/issues/93)) ([fc05f87](https://github.com/buildproven/claude-kit/commit/fc05f87fb2bfedc44d6a9b74ac45533b3c663eb9))
* **config:** remove orphaned statusLine from template, document claude-hud ([#58](https://github.com/buildproven/claude-kit/issues/58)) ([195d57b](https://github.com/buildproven/claude-kit/commit/195d57bfad74c63f6c0a4bc0667eb8a5a87695be))
* **csc1:** exempt commands/OVERRIDES.md from command contract lint ([#165](https://github.com/buildproven/claude-kit/issues/165)) ([5e29cec](https://github.com/buildproven/claude-kit/commit/5e29cec6cc1294ba774cc43a8302abc7fb62f7ed))
* **csc1:** scope overrides registry exemption ([#168](https://github.com/buildproven/claude-kit/issues/168)) ([a36ff6d](https://github.com/buildproven/claude-kit/commit/a36ff6db40f85c9f8756ee6ccd5223869464ce2c))
* **deps:** rewrite /bs:deps as executable instructions ([#50](https://github.com/buildproven/claude-kit/issues/50)) ([c3b7797](https://github.com/buildproven/claude-kit/commit/c3b7797122ac9e5ed9358f2b317502b72c9c98da))
* **docs:** add missing hotfix command wrapper, caveat recover-quality templates ([#140](https://github.com/buildproven/claude-kit/issues/140)) ([6676b1f](https://github.com/buildproven/claude-kit/commit/6676b1fc04d40571549f6de67630fdc74de9a3c3))
* **docs:** resolve changelog helper beside gate ([#106](https://github.com/buildproven/claude-kit/issues/106)) ([9289751](https://github.com/buildproven/claude-kit/commit/928975121b67b783b201ded8dce2a81a66f4e9e5))
* enforce review verdict consistency ([#103](https://github.com/buildproven/claude-kit/issues/103)) ([74b403c](https://github.com/buildproven/claude-kit/commit/74b403c957941a8947227465153eb86c33b4976b))
* **gates:** stop untracked scratch space from breaking five gates ([#229](https://github.com/buildproven/claude-kit/issues/229)) ([b19a162](https://github.com/buildproven/claude-kit/commit/b19a162487f2ff192b47292d976b77be4667d768))
* **help:** glob ~/.claude/commands/bs for all tiers; dynamic pro section ([#49](https://github.com/buildproven/claude-kit/issues/49)) ([e27e469](https://github.com/buildproven/claude-kit/commit/e27e469bdc4da81e7b3329bef9c141b00d5ffcbd))
* honor named quality review levels ([#162](https://github.com/buildproven/claude-kit/issues/162)) ([8344462](https://github.com/buildproven/claude-kit/commit/8344462dadc0efcfa2435b07b933095226f98fa2))
* honor repository Node versions in steward ([#99](https://github.com/buildproven/claude-kit/issues/99)) ([0412d0c](https://github.com/buildproven/claude-kit/commit/0412d0c223618f1c750c70335b5fbd3ec32b2529))
* **hooks:** block recursive rm nested in shell control constructs ([#136](https://github.com/buildproven/claude-kit/issues/136)) ([69434de](https://github.com/buildproven/claude-kit/commit/69434de238b722d2ca5208baa2baa96d4764cc34))
* **hooks:** close destructive-path guard bypasses ([#228](https://github.com/buildproven/claude-kit/issues/228)) ([9dd9417](https://github.com/buildproven/claude-kit/commit/9dd9417e8c228734268e4ec0c27d3840487616a5))
* **hooks:** report detected secrets instead of failing open ([#230](https://github.com/buildproven/claude-kit/issues/230)) ([4427b45](https://github.com/buildproven/claude-kit/commit/4427b453a3c3239a3a7b6f2c0e3ce613509d24d9))
* **hooks:** resolve the git dir so session hooks work in worktrees ([#233](https://github.com/buildproven/claude-kit/issues/233)) ([29b5def](https://github.com/buildproven/claude-kit/commit/29b5defc96d0684ca499a96441f291876b541efd))
* **hooks:** restore branch protection dead since v1.0.0 ([#227](https://github.com/buildproven/claude-kit/issues/227)) ([b6ca4f2](https://github.com/buildproven/claude-kit/commit/b6ca4f2c85ec36325edbc51ba4d28eb4529a0e66))
* **hooks:** stop-validation.sh crashes in bare repos ([#112](https://github.com/buildproven/claude-kit/issues/112)) ([f86594d](https://github.com/buildproven/claude-kit/commit/f86594dd4654bd4742e1ee10de084da1f6f67741))
* **husky:** restore executable bit on git hooks ([#61](https://github.com/buildproven/claude-kit/issues/61)) ([d3b21cf](https://github.com/buildproven/claude-kit/commit/d3b21cf6ef644283d958537842a90671b9fa8dbf))
* keep MCP sync non-interactive ([#97](https://github.com/buildproven/claude-kit/issues/97)) ([fc5ecd3](https://github.com/buildproven/claude-kit/commit/fc5ecd37cf295e110f8ccda6a69366a09caedb7b))
* lint overlays without crossing submodule contracts ([#91](https://github.com/buildproven/claude-kit/issues/91)) ([de4f1c5](https://github.com/buildproven/claude-kit/commit/de4f1c53396a8356da757c170692685e8fd4b8dd))
* make Gemini opt-in and diagnosable ([#130](https://github.com/buildproven/claude-kit/issues/130)) ([850ec7f](https://github.com/buildproven/claude-kit/commit/850ec7fd4e8cb2ae3e783ba6fa2999f5d1dbc8e5))
* make unresolved review-agent definitions fail loud (BUI-461) ([#184](https://github.com/buildproven/claude-kit/issues/184)) ([e4e770a](https://github.com/buildproven/claude-kit/commit/e4e770a95d9754a10b048615669f71b5344b19f8))
* map steward repos to primary checkouts ([#96](https://github.com/buildproven/claude-kit/issues/96)) ([d44ce78](https://github.com/buildproven/claude-kit/commit/d44ce7889cfbde0fc57264744897ebbe41c49184))
* **merge-train:** enforce shared quality reservations ([#174](https://github.com/buildproven/claude-kit/issues/174)) ([461ce68](https://github.com/buildproven/claude-kit/commit/461ce68138042fb46e94399998bf8ae329dfa5e3))
* **notify:** pass text as argv, closing an AppleScript injection ([#122](https://github.com/buildproven/claude-kit/issues/122)) ([30d1f6a](https://github.com/buildproven/claude-kit/commit/30d1f6a0d7944e470a7a77301a3f85783a24783e))
* OSS boundary + quality-pipeline bugs + mechanical model routing ([#85](https://github.com/buildproven/claude-kit/issues/85)) ([1199113](https://github.com/buildproven/claude-kit/commit/1199113b16252ddc79cd9f14b2a831f7fc3f4a0b))
* **plugin:** quote colon-bearing YAML description, wire CI validation ([#127](https://github.com/buildproven/claude-kit/issues/127)) ([82f373c](https://github.com/buildproven/claude-kit/commit/82f373cc669570540b30ed54845c9b5048baee0c))
* **provider:** drop removed -a flag from codex exec invocation ([#116](https://github.com/buildproven/claude-kit/issues/116)) ([f02771c](https://github.com/buildproven/claude-kit/commit/f02771cbc997a154da043e31cf9d7608f056d699))
* **quality,dev:** remove paid-tier Codex refs + fix acpx 0.5.3 syntax ([#16](https://github.com/buildproven/claude-kit/issues/16)) ([724109a](https://github.com/buildproven/claude-kit/commit/724109aefdd5cb42f178f831427d6c24f5b094b9))
* **quality:** accept --target-dir for forked invocations (port from kit-pro [#19](https://github.com/buildproven/claude-kit/issues/19)) ([#24](https://github.com/buildproven/claude-kit/issues/24)) ([77bfe5c](https://github.com/buildproven/claude-kit/commit/77bfe5cc910318ad3607e5dfca5cb13b5b6ba18d))
* **quality:** accept bare no-findings markers ([#154](https://github.com/buildproven/claude-kit/issues/154)) ([9506ff1](https://github.com/buildproven/claude-kit/commit/9506ff142520068fce1ec791413fecfd913ff971))
* **quality:** accept clean Codex prose verdicts, unblock merges (BUI-359) ([#119](https://github.com/buildproven/claude-kit/issues/119)) ([8ea35ee](https://github.com/buildproven/claude-kit/commit/8ea35ee50743a5c797f7297b963de0fa46b813ec))
* **quality:** accept no-findings sentinel preceded by rationale prose ([#177](https://github.com/buildproven/claude-kit/issues/177)) ([65111ac](https://github.com/buildproven/claude-kit/commit/65111acaf94cc866d9902b0749e312a3a7f97138))
* **quality:** add run-governor guardrails for runaway autonomous loops ([#67](https://github.com/buildproven/claude-kit/issues/67)) ([402aa14](https://github.com/buildproven/claude-kit/commit/402aa1462574bf6706f6b2672d14ac24dd12a0c5))
* **quality:** block the merge on failing reviews, and stop the gates being truncated ([#77](https://github.com/buildproven/claude-kit/issues/77)) ([1d26ef9](https://github.com/buildproven/claude-kit/commit/1d26ef9409dc3c687c21ac49f510161dd0371ba9))
* **quality:** close final evidence gaps ([#110](https://github.com/buildproven/claude-kit/issues/110)) ([9601a55](https://github.com/buildproven/claude-kit/commit/9601a55cff3332b572c7c2e4da40c3c148a10bc3))
* **quality:** coach user on --scope changed for tiny critical/high-tier changes ([#31](https://github.com/buildproven/claude-kit/issues/31)) ([c0ca714](https://github.com/buildproven/claude-kit/commit/c0ca7141c115cd9b7ce0db0e368ec8ff908c8f50))
* **quality:** codex-companion.mjs path lookup had no fallback candidates ([#66](https://github.com/buildproven/claude-kit/issues/66)) ([94b0153](https://github.com/buildproven/claude-kit/commit/94b0153043683ce7220d3f6411f246db2837144a))
* **quality:** complete signed review evidence ([#214](https://github.com/buildproven/claude-kit/issues/214)) ([201c161](https://github.com/buildproven/claude-kit/commit/201c1611288e4a8f4acafcaa54e110f8fd553796))
* **quality:** enforce efficient bounded reviews ([#104](https://github.com/buildproven/claude-kit/issues/104)) ([cc10fe3](https://github.com/buildproven/claude-kit/commit/cc10fe39f6ad4a0d1fa9d8ee7b1c7e188727f3fb))
* **quality:** enforce the reviewer quorum per review, not per campaign ([#235](https://github.com/buildproven/claude-kit/issues/235)) ([87914d0](https://github.com/buildproven/claude-kit/commit/87914d08e3993dfc92c99a5f1b053535269cc2fe))
* **quality:** fail over inconclusive reviews ([#135](https://github.com/buildproven/claude-kit/issues/135)) ([202d3d4](https://github.com/buildproven/claude-kit/commit/202d3d47d6dd944e30b137ed0f383c4016fa11f8))
* **quality:** fail over on Codex OAuth refresh failure ([#216](https://github.com/buildproven/claude-kit/issues/216)) ([a9bf311](https://github.com/buildproven/claude-kit/commit/a9bf311fff11629cd464e9bfe7361a0ae44ead4d))
* **quality:** fail over to fallback provider on rc=77 budget-decline (BUI-348) ([#148](https://github.com/buildproven/claude-kit/issues/148)) ([b9ab249](https://github.com/buildproven/claude-kit/commit/b9ab2497ceca510541a4de3ab6b3e7091b7d8f70))
* **quality:** fall back to the secondary provider on review timeout ([#120](https://github.com/buildproven/claude-kit/issues/120)) ([54d12ea](https://github.com/buildproven/claude-kit/commit/54d12ea5b442db4c842cb8c0e80dbcf7ce7c02c4))
* **quality:** forbid skill from bailing to status-report mode after Step -1 ([#45](https://github.com/buildproven/claude-kit/issues/45)) ([6e7d839](https://github.com/buildproven/claude-kit/commit/6e7d83933c4dc403470346b9b2906ca875c80dba))
* **quality:** harden merge-train contracts ([#192](https://github.com/buildproven/claude-kit/issues/192)) ([a4cb86a](https://github.com/buildproven/claude-kit/commit/a4cb86a7b0db4d42316c890c73d2ddc7f81b7e9d))
* **quality:** harden orchestration surfaces ([#149](https://github.com/buildproven/claude-kit/issues/149)) ([dbe6bc6](https://github.com/buildproven/claude-kit/commit/dbe6bc6f170cb974ae9dd7e7f0e438533f7f4f3d))
* **quality:** honor validated CI billing waivers ([#134](https://github.com/buildproven/claude-kit/issues/134)) ([c1562d2](https://github.com/buildproven/claude-kit/commit/c1562d2c8b763fa4507da243c9863eb2b205ba07))
* **quality:** inherit parent model instead of pinning sonnet ([#15](https://github.com/buildproven/claude-kit/issues/15)) ([9cb09d6](https://github.com/buildproven/claude-kit/commit/9cb09d68eba3f9bfbaaa620985a21c5df799a2c9))
* **quality:** isolate Codex reviews from user MCP config ([#220](https://github.com/buildproven/claude-kit/issues/220)) ([1341254](https://github.com/buildproven/claude-kit/commit/1341254822fbece00862a32ad9d0065391663566))
* **quality:** isolate revision-bound merge state ([#100](https://github.com/buildproven/claude-kit/issues/100)) ([12b3ae4](https://github.com/buildproven/claude-kit/commit/12b3ae49e76279d3730eeaf0cc9da660344b8fce))
* **quality:** let break-glass approval survive a rebase-only HEAD change ([#141](https://github.com/buildproven/claude-kit/issues/141)) ([021f9bb](https://github.com/buildproven/claude-kit/commit/021f9bb5488d92f1e339d02bc92ce0358a5ceda1))
* **quality:** make campaigns durable and failure-aware (BUI-357) ([#117](https://github.com/buildproven/claude-kit/issues/117)) ([2d5c1fe](https://github.com/buildproven/claude-kit/commit/2d5c1fe9f5e89d1e9755cc0769154731620c00b9))
* **quality:** make concurrent review runs converge ([#98](https://github.com/buildproven/claude-kit/issues/98)) ([50dea5c](https://github.com/buildproven/claude-kit/commit/50dea5cab724c1bed71e788bc854ebcd868ab40e))
* **quality:** make low-risk AI review advisory ([#173](https://github.com/buildproven/claude-kit/issues/173)) ([f5ab589](https://github.com/buildproven/claude-kit/commit/f5ab5898b73dbcb3c229b96b07d0daaa7eb96570))
* **quality:** make rename risk and failure recovery actionable ([#129](https://github.com/buildproven/claude-kit/issues/129)) ([ca5ba6e](https://github.com/buildproven/claude-kit/commit/ca5ba6e1e5c6f625de6674bec8b1c73d12e93552))
* **quality:** make review agents synchronous so --merge completes ([#63](https://github.com/buildproven/claude-kit/issues/63)) ([0f190a4](https://github.com/buildproven/claude-kit/commit/0f190a487bfe361bc5b16ffc405bc2dbb438f1dc))
* **quality:** make risk scorer's workflow security floor content-aware (BUI-381) ([#143](https://github.com/buildproven/claude-kit/issues/143)) ([cf29057](https://github.com/buildproven/claude-kit/commit/cf29057f8dd9dede61330bbf2dd930e77fc1c2bc))
* **quality:** namespace gitroot sentinel by target, not just session ([#60](https://github.com/buildproven/claude-kit/issues/60)) ([421fbe4](https://github.com/buildproven/claude-kit/commit/421fbe4f4f5f75194108f06d8211d9e9e274d189))
* **quality:** normalize same-provider fallback ([#224](https://github.com/buildproven/claude-kit/issues/224)) ([3b6c054](https://github.com/buildproven/claude-kit/commit/3b6c0542c0b7165a40be0decb2c9787ef4bc94d3))
* **quality:** persist $ARGUMENTS to tempfile, pass via --args-file ([#26](https://github.com/buildproven/claude-kit/issues/26)) ([b1991f6](https://github.com/buildproven/claude-kit/commit/b1991f66c1c14cb167700f6b0ab6e9336ec83980))
* **quality:** persist git root so --target-dir survives forked Bash blocks ([#33](https://github.com/buildproven/claude-kit/issues/33)) ([fd1ef6c](https://github.com/buildproven/claude-kit/commit/fd1ef6c453a3048728d68679f554cad90ee840e5))
* **quality:** persist terminal gate failures ([#226](https://github.com/buildproven/claude-kit/issues/226)) ([9c5ab80](https://github.com/buildproven/claude-kit/commit/9c5ab8053e18a6c2c55cd093d6646060321324ac))
* **quality:** pin a non-1M review model ([#191](https://github.com/buildproven/claude-kit/issues/191)) ([4628a15](https://github.com/buildproven/claude-kit/commit/4628a1555f9a6ec24fb2f40d06deebb0479b8b77))
* **quality:** preflight signed primary-only stamps ([#218](https://github.com/buildproven/claude-kit/issues/218)) ([78e06ec](https://github.com/buildproven/claude-kit/commit/78e06ec95da6f89569ec40b7a3e1e357a477af22))
* **quality:** probe codex cache health, skip to fallback when unwinnable (BUI-352) ([#124](https://github.com/buildproven/claude-kit/issues/124)) ([9445fac](https://github.com/buildproven/claude-kit/commit/9445fac7f20779587fc68f1d2a1bb8cd66d6bf3b))
* **quality:** prove config changes via the test that guards them (BUI-511) ([#189](https://github.com/buildproven/claude-kit/issues/189)) ([c0430be](https://github.com/buildproven/claude-kit/commit/c0430be908124cac3b59f28b4c5f2ee0db9ecf22))
* **quality:** record mutation evidence for the gitlink-skip path ([#181](https://github.com/buildproven/claude-kit/issues/181)) ([994d3af](https://github.com/buildproven/claude-kit/commit/994d3af8c59347c204bede79d060b3b4e479d4bc))
* **quality:** require structured Claude review output ([#199](https://github.com/buildproven/claude-kit/issues/199)) ([f53c7ad](https://github.com/buildproven/claude-kit/commit/f53c7ad5af70c5a0b8aba6bda2333e5b125d7245))
* **quality:** reserve gate time before review ([#171](https://github.com/buildproven/claude-kit/issues/171)) ([99a713a](https://github.com/buildproven/claude-kit/commit/99a713aa8c859805834f5d9118745ed770c03cc5))
* **quality:** retry PR HEAD check to survive GitHub read-after-write lag ([#178](https://github.com/buildproven/claude-kit/issues/178)) ([bcbcd29](https://github.com/buildproven/claude-kit/commit/bcbcd2944597ea1df1a988ba0c9606a5e385a49a))
* **quality:** scope --pr resolution to --target-dir's repo (BUI-391) ([#186](https://github.com/buildproven/claude-kit/issues/186)) ([860e108](https://github.com/buildproven/claude-kit/commit/860e1081723978f5a97a630941f37e1cb33e64da))
* **quality:** separate execution and lifecycle budgets ([#163](https://github.com/buildproven/claude-kit/issues/163)) ([3daca2d](https://github.com/buildproven/claude-kit/commit/3daca2d966a78c188623e6bb1753ffe690487fd2))
* **quality:** size submodule review budgets from child diff (BUI-358) ([#167](https://github.com/buildproven/claude-kit/issues/167)) ([9a95938](https://github.com/buildproven/claude-kit/commit/9a959387042a81979be2e78cea18aabfd995d1fd))
* **quality:** skip mutation gate for pure gitlink diffs (BUI-464) ([#179](https://github.com/buildproven/claude-kit/issues/179)) ([cffa0b8](https://github.com/buildproven/claude-kit/commit/cffa0b82148bb2a6b7f2d3e43eabc049bedabcfc))
* **quality:** skip mutation gate on diffs with no mutable source (BUI-483) ([#188](https://github.com/buildproven/claude-kit/issues/188)) ([bb77e25](https://github.com/buildproven/claude-kit/commit/bb77e2532c1bdcd4286e357f4e54488f46d47ba5))
* **quality:** stop false-positive "base changed during bootstrap" from stale gh pr view cache (BUI-382) ([#144](https://github.com/buildproven/claude-kit/issues/144)) ([b0d84f7](https://github.com/buildproven/claude-kit/commit/b0d84f7310373b3c01b491c47fffcc5a585fc3d1))
* **quality:** support shell mutation targets ([#170](https://github.com/buildproven/claude-kit/issues/170)) ([a757b25](https://github.com/buildproven/claude-kit/commit/a757b25b9a0d8f9c2b78e286d1a52ab62214fd85))
* **quality:** surface Codex quota reset details ([#94](https://github.com/buildproven/claude-kit/issues/94)) ([7a269a9](https://github.com/buildproven/claude-kit/commit/7a269a9ad62406d966d3ca263bdcd10622cee71f))
* **quality:** top-of-skill directive to prevent fork-drift ([#44](https://github.com/buildproven/claude-kit/issues/44)) ([c9f0463](https://github.com/buildproven/claude-kit/commit/c9f04639d913ba3c21cd438ad7017530dba38633))
* **quality:** treat an empty findings sentinel as malformed, not blocking ([#190](https://github.com/buildproven/claude-kit/issues/190)) ([7891a26](https://github.com/buildproven/claude-kit/commit/7891a2618f6a98f92bcf36b6d0fde1e0f3ab4502))
* **quality:** unblock merges on unprotectable bases; exclude N/A sota scores ([#126](https://github.com/buildproven/claude-kit/issues/126)) ([950d263](https://github.com/buildproven/claude-kit/commit/950d26343f86a5dabddb046337e56c9f174d2898))
* **quality:** validate all CI on unprotectable repos ([#138](https://github.com/buildproven/claude-kit/issues/138)) ([8a7b098](https://github.com/buildproven/claude-kit/commit/8a7b098a8b4a4de4dc1604c6afc052a9a32ef2b8))
* **quality:** verify signed CI review evidence ([#219](https://github.com/buildproven/claude-kit/issues/219)) ([7ec316a](https://github.com/buildproven/claude-kit/commit/7ec316a694ef55a9c74c7dc31c827d0eb74e354d))
* **quality:** Wave 1 — close fail-open channels + deterministic risk base ([#113](https://github.com/buildproven/claude-kit/issues/113)) ([4887ee8](https://github.com/buildproven/claude-kit/commit/4887ee82e05ff054daa4f30ef3fc0a5d75fe78f5))
* **ralph:** gate autonomous loop context and usage ([#150](https://github.com/buildproven/claude-kit/issues/150)) ([e70e35a](https://github.com/buildproven/claude-kit/commit/e70e35a444b06f15e1edff011bd38ce3d7eb95fb))
* **ralph:** stop marking backlog items done without doing the work ([#240](https://github.com/buildproven/claude-kit/issues/240)) ([5a03c0a](https://github.com/buildproven/claude-kit/commit/5a03c0acde1b954769d4ef3b3fdf6e75422e0411))
* **release:** patch fast-uri vuln, fix format, sync command README ([#27](https://github.com/buildproven/claude-kit/issues/27)) ([d0661cc](https://github.com/buildproven/claude-kit/commit/d0661cc1d653fb1840de99c9baba5024998cf28a))
* remove the last references to commands this repo doesn't ship ([#78](https://github.com/buildproven/claude-kit/issues/78)) ([70282b1](https://github.com/buildproven/claude-kit/commit/70282b1f3dae7d8e9d606663df3db2800450ad36))
* repair curl installer upgrade path for pre-manifest checkouts (BUI-444) ([#183](https://github.com/buildproven/claude-kit/issues/183)) ([0d178af](https://github.com/buildproven/claude-kit/commit/0d178afc1090f5e95f40323579eaaa36cd09bb02))
* repair the broken public install, defang contributor-hostile CI ([#74](https://github.com/buildproven/claude-kit/issues/74)) ([2b87682](https://github.com/buildproven/claude-kit/commit/2b8768205d71b249d321adbabade940c8cfdf8db))
* replace ((var++)) with var=$((var+1)) under set -e ([#68](https://github.com/buildproven/claude-kit/issues/68)) ([1f3b5e3](https://github.com/buildproven/claude-kit/commit/1f3b5e39644b7965d9748df70fc67b4af087472e))
* resolve kit scripts by candidate chain, not a path that exists nowhere ([#83](https://github.com/buildproven/claude-kit/issues/83)) ([95e93f1](https://github.com/buildproven/claude-kit/commit/95e93f1221e9058e14206a16d2a49f133fd3bbbd))
* resolve overlay root correctly when embedded as a nested submodule ([#147](https://github.com/buildproven/claude-kit/issues/147)) ([2f89176](https://github.com/buildproven/claude-kit/commit/2f891760960777d0a482a12ed1a5fba044404765))
* **risk:** fail closed on unreadable diffs and job-level permissions ([#232](https://github.com/buildproven/claude-kit/issues/232)) ([90cb6dd](https://github.com/buildproven/claude-kit/commit/90cb6dd10223325f63175526d7ea7f2a477fa2fe))
* route review effort from change evidence ([#210](https://github.com/buildproven/claude-kit/issues/210)) ([1770342](https://github.com/buildproven/claude-kit/commit/17703421ab70877e0117feae8845c81641c96e89))
* **safety:** remove recursive temp cleanup trap ([#107](https://github.com/buildproven/claude-kit/issues/107)) ([715a259](https://github.com/buildproven/claude-kit/commit/715a25916ab9476f220a9fb566217bc08c9c09f1))
* **scripts:** classify provider exhaustion from structured events only (BUI-325) ([#185](https://github.com/buildproven/claude-kit/issues/185)) ([4947f4c](https://github.com/buildproven/claude-kit/commit/4947f4c4bccbe1a8ee5768e8ad0662ba2fbcf48c))
* **scrub:** catch CHANGELOG, CONTRIBUTING, and env var docs gaps in opensource mode ([#14](https://github.com/buildproven/claude-kit/issues/14)) ([986bec5](https://github.com/buildproven/claude-kit/commit/986bec5909398898fce2ba04fd0cd8157483580d))
* **security:** replace license-checker with maintained rseidelsohn fork (BUI-473) ([#182](https://github.com/buildproven/claude-kit/issues/182)) ([4df5e97](https://github.com/buildproven/claude-kit/commit/4df5e9779060f73740b54465c55a0b7b7cbd2609))
* **skills:** block AskUserQuestion in the 5 skills that run unattended ([#72](https://github.com/buildproven/claude-kit/issues/72)) ([fbd4679](https://github.com/buildproven/claude-kit/commit/fbd46795a6842c5b94d6c694e4b799e174d367b8))
* stop session-health spam + fork heavy autonomous skills ([#65](https://github.com/buildproven/claude-kit/issues/65)) ([efa645a](https://github.com/buildproven/claude-kit/commit/efa645a82bf51b69515615d704209ae89df2a8c4))
* stop the kit deleting the user's branches and hijacking their working tree ([#76](https://github.com/buildproven/claude-kit/issues/76)) ([698bfec](https://github.com/buildproven/claude-kit/commit/698bfec58b8fe6ef269a64b00eed4abbf0d3826c))
* **sync:** stop --repair bricking the install when run via the symlink ([#75](https://github.com/buildproven/claude-kit/issues/75)) ([e45c7a8](https://github.com/buildproven/claude-kit/commit/e45c7a84df4a35492c17e43ffb48b48358aa7f5e))
* **workflow:** base suggested branches on origin ([#196](https://github.com/buildproven/claude-kit/issues/196)) ([3c8859e](https://github.com/buildproven/claude-kit/commit/3c8859e9767da2f18d24dda6a3cc68bc549e352c))
* **worktree:** preserve safety during forced cleanup ([4c80fad](https://github.com/buildproven/claude-kit/commit/4c80fadf3f72b35ae463e30d9faf027724da6c3d))
* **worktree:** refresh origin before basing new worktrees on default branch ([#172](https://github.com/buildproven/claude-kit/issues/172)) ([e40b249](https://github.com/buildproven/claude-kit/commit/e40b24901183411f48fde7ac18f430e80bf7a466))
* **worktree:** remove eligible submodule worktrees ([#152](https://github.com/buildproven/claude-kit/issues/152)) ([242979c](https://github.com/buildproven/claude-kit/commit/242979c2e18c1f4955c3855c885ab3a19654d6f9))
* **worktrees:** make stale-lock recovery atomic and release safe ([#234](https://github.com/buildproven/claude-kit/issues/234)) ([9d8f891](https://github.com/buildproven/claude-kit/commit/9d8f891e946548bcbb07da4f4fdb4f3496413fa1))
* **worktrees:** reconcile terminal quality locks safely ([#225](https://github.com/buildproven/claude-kit/issues/225)) ([51ea736](https://github.com/buildproven/claude-kit/commit/51ea736706e060f41aca9a38b5739ea43e1466f7))
* **worktrees:** reject unparseable removal thresholds ([#231](https://github.com/buildproven/claude-kit/issues/231)) ([ab700c2](https://github.com/buildproven/claude-kit/commit/ab700c29ff433210bd6a9c8bb79d9e8b391e2a5e))


### Performance Improvements

* **ci:** consolidate quality jobs to eliminate per-job round-up ([#123](https://github.com/buildproven/claude-kit/issues/123)) ([a2505b6](https://github.com/buildproven/claude-kit/commit/a2505b60cb173d84c783ef1191a8f4dac93935c3))
* trim default Codex skill surface ([#102](https://github.com/buildproven/claude-kit/issues/102)) ([cdf510a](https://github.com/buildproven/claude-kit/commit/cdf510ac9dd96555474d2f1da505c9c4c8b85af8))

## [4.1.0] - 2026-07-19

### Added

- Tool-agnostic provider parity for Codex and Claude Code across the quality
  workflow (#121).
- Campaign telemetry recorder for quality runs (#115).
- Repo-context-aware critical gate with an always-human review floor (#128).
- Strengthened engineering and UI design disciplines in shared skills (#105).
- Review depth now routes by task type instead of a single fixed policy (#133).
- Unified worktree lifecycle management (#131).

### Changed

- Quality provider health probing now detects an unwinnable Codex cache and
  skips straight to fallback instead of stalling (#124).
- Quality CI jobs consolidated to eliminate per-job round-up overhead (#123).
- Default Codex skill surface trimmed to reduce install footprint (#102).
- Risk-change-nature detection extracted into a single shared module so
  fail-open channels can't diverge between call sites (#113, #114).

### Fixed

- Concurrent quality review runs now converge instead of racing to
  inconsistent verdicts (#98).
- Review verdict consistency enforced across providers (#103).
- Quality reviews are bounded to avoid runaway cost (#104).
- Merge state is isolated per revision, closing a cross-run leak (#100).
- Final evidence gaps in the quality gate closed (#110).
- `stop-validation.sh` no longer crashes in bare repositories (#112).
- Codex clean prose verdicts are accepted instead of blocking merges (#119).
- Removed a `-a` flag from `codex exec` invocations that Codex no longer
  supports (#116).
- Quality falls back to the secondary provider on review timeout (#120).
- Merges on unprotectable bases are no longer blocked; N/A SOTA scores are
  excluded from scoring (#126).
- Plugin manifest YAML with a colon-bearing description is now quoted
  correctly, with CI validation added to catch regressions (#127).
- Rename risk detection and failure recovery made actionable instead of
  silently degrading (#129).
- Quality campaigns are now durable and failure-aware across interruptions
  (#117).
- Validated CI billing waivers are now honored instead of blocking merges
  (#134).
- Gemini provider support is now opt-in and diagnosable instead of silently
  misconfigured (#130).
- CI is now validated on unprotectable repos instead of being skipped (#138).
- A recursive temp-cleanup trap that could delete unintended paths was
  removed (#107).
- Vitest global timeout raised to fix parallel-load flakes (#118).
- Changelog helper now resolves beside the gate it documents (#106).

### Security

- `notify` now passes text as an argv element instead of interpolating it
  into an AppleScript string, closing an AppleScript injection vector (#122).

## [4.0.1] - 2026-07-16

### Fixed

- Active-repository discovery now maps GitHub repositories only to primary
  checkouts, never to ephemeral linked worktrees with the same remote.

## [4.0.0] - 2026-07-16

### Added

- Native Codex Agent Skills installation from a curated allowlist, with drift
  checking and the same canonical instructions used by Claude Code.
- A provider-neutral runner and shared policy for Codex-primary, Claude-primary,
  explicit fallback, typed quota/authentication/timeout failures, and bounded runs.
- Active-repository fleet discovery and convergence auditing, plus isolated
  worktree repair mode through the repository's normal PR quality workflow.
- Declarative MCP parity tooling for Claude Code and Codex, including forced
  convergence and separate OAuth login.
- A command/skill surface audit with an explicit public command budget.

### Changed

- Overnight loop engineering now uses the shared provider policy instead of
  hardcoding Claude Code.
- Twelve redundant command wrappers were removed. Their durable skills remain
  available where they are useful; internal implementation skills are hidden from
  user menus with `user-invocable: false`.
- Steward state moved out of the repository into the XDG state directory.
- The distributed plugin and marketplace manifests now match v4.0.0, and the
  duplicate standard hooks declaration was removed so fresh installs load cleanly.

## [3.2.0] - 2026-07-15

### Changed

- Removed the lightly modified vendored `webapp-testing` skill; Anthropic's upstream
  repository is now the canonical maintained source.
- Documented the substantial modifications and Apache-2.0 attribution for
  `frontend-design`; all other kit content remains MIT.
- Made plugin installs resolve the inline-list parser and ensemble runner through
  `CLAUDE_PLUGIN_ROOT`.
- Raised the supported runtime floor to Node 24 LTS and committed the npm lockfile
  for reproducible `npm ci` builds.
- Upgraded the lint and commit toolchain, including ESLint 10 compatibility for
  the bundled defensive rules.

### Security and quality

- Added sandbox credential and metadata-network protections while using Claude
  Code's guarded `auto` permission mode.
- Promoted the tested destructive-path hook from the private overlay into the
  public kit and wired it before every Bash tool call.
- Made Semgrep findings fail CI, added license enforcement and a pre-push security
  gate, and enabled weekly dependency and GitHub Actions updates.
- Removed destructive stale-branch automation and two dead private-only scripts.
- Corrected SOTA scoring for sandbox networking, skill frontmatter, CI security,
  plugin-native paths, git hooks, and opt-in OpenTelemetry.
- Added direct tests for every published defensive ESLint rule and hardened JSX
  handler analysis against namespaced and short prop names.

## [3.1.0] - 2026-07-13

The kit stops doing things to your repo that you didn't ask for.

### BREAKING — the hooks no longer mutate your working tree

**`session-start-context.sh` was force-deleting your branches.** On every session
start, in whatever repo you had open, it ran `git branch -D` on every branch whose
upstream was gone, and `git branch -d` on merged ones. No prompt, no opt-out — and
it was wired into the _recommended_ plugin install.

`-D` is a force delete. If a remote branch was deleted while you still had unpushed
local commits, those commits went with it. Install the plugin, open Claude in an
unrelated repo, lose work.

It now **reports** and deletes nothing:

> 🌿 Branches whose remote is gone: `feature` — review, then `git branch -D` if
> you're sure (they may hold unpushed commits).

Set `CLAUDE_KIT_AUTO_PRUNE=1` to restore the old behavior. Off by default.

**`auto-branch-on-main.sh` was switching your branch mid-edit.** On any Edit/Write
while on `main` it ran `git checkout -b feat/<filename>` in your tree — and if the
branch already existed, a bare `git checkout`, which carries uncommitted changes
across it. Every git call was `2>/dev/null`, so failures were invisible.

It now **denies with a message** telling you what to run (exit 2) — which is what
its own header always claimed it did, and what `block-commit-main.sh` already does.
Set `CLAUDE_KIT_ALLOW_MAIN_EDITS=1` to disable the hook.

### BREAKING — the quality gate now blocks on failing reviews

`BLOCKING_COUNT` was only ever interpolated into the `Reviewed-By` trailer text
(`findings=2`); it was never compared to zero. Every `MERGE BLOCKED` guard verified
the review _ran_ — none verified it _passed_. An attendance register, not an exam.

Unresolved BLOCKING findings now abort the merge.

Compounding it: `skills/quality/SKILL.md` was **17,394 tokens against a 5,000-token
compaction re-attach cap**, so the merge gates — which live late in the file —
silently ceased to exist after any compaction, i.e. in exactly the long sessions
where they matter most. The CI check for this was `continue-on-error: true`.

SKILL.md is now split (under 5,000 tokens) and `check-skill-size.sh` is a hard gate.

### BREAKING — defaults that surprised you

- **`fallbackModel` was Opus-first.** A stranger on a metered plan installed this and
  was billed at Opus rates by default. Now `claude-sonnet-5` → `claude-haiku-4-5`.
- **`alwaysThinkingEnabled: true`** forced extended thinking on for everyone.
  Thinking tokens are output tokens. Removed — that's your call, not the toolkit's.
- **`permissions.allow` blanket-allowed `mcp__*`**, i.e. every tool from every MCP
  server you might install. Removed.

### Fixed

- **`Bash(chown -R:*)` never fired.** Per the permissions docs, `:*` is only
  recognized at the _end_ of a pattern; a mid-pattern colon is a literal. So this
  prefix-matched the string `chown -R:` and matched nothing. A user read a deny rule
  that appeared to block recursive chown; it didn't.
- **The flaky detector counted a skipped test as a failure.** Any conditionally
  skipped test (env var, platform, missing binary) flipped pass↔fail between runs,
  got flagged flaky, and failed the run with exit 1 — a false-positive generator
  inside the false-positive detector. Also, its `flips` field reported the number of
  _runs_, not transitions.
- **`/bs:strategy` exited 0 with an empty report** when `acpx` (a binary named in no
  README, installed by nothing) was absent. It now fails loudly with an install
  pointer, and exits non-zero when every provider fails.
- **`/bs:backlog`, `/bs:dev --next` and `/bs:triage`** hard-required Linear/Sentry MCP
  servers with no detection and no message. They now say what's missing and stop.
- **Notification hooks ran raw `osascript`**, which does not exist on Linux/WSL — so
  the hook exited 127 on every permission prompt, every idle prompt and every agent
  completion. Replaced with `scripts/notify.sh` (osascript / notify-send / silent).
- Removed a vendored third-party **facebook-mcp-server** and a `.env.template` of 20
  social-media credentials, neither read by any shipped command.
- Removed maintainer-only references — `keyflash`, `BUI-*` ticket IDs, private doc
  paths, and one instruction to obtain "written permission from Brett" — that
  `CONTRIBUTING.md` itself forbids.

### Added

- **Coverage 64.76% → 87.94%** (312 tests, up from 237). The gap was worst in the
  differentiated part: `risk-score.js` (62% → 84%) and the run governor's `bumpRound`
  — the round cap that terminates the fix→re-review loop — which had **no tests at
  all** despite its whole safety property being that it fails closed.
- Regression tests that pin the three failures above: a real `: gone]` branch holding
  an unpushed commit must survive; `BLOCKING_COUNT` must be _compared_, not merely
  interpolated; SKILL.md must stay inside the compaction budget.
- A **Prerequisites** section in the README. There wasn't one.

### Changed

- `requiredMinimumVersion` 2.1.198 → 2.1.207.
- `requiredMinimumVersion` 2.1.207 → 2.1.210 for the latest worktree and
  destructive-path safety fixes.

## [3.0.0] - 2026-07-12

The paid tier is gone. claude-kit is now the whole thing, free and MIT.

### Changed — claude-kit-pro folded in and archived

Anthropic shipped the orchestration layer natively (workflows, background agents,
agent teams), which is most of what the paid tier sold. Keeping a middle tier that
duplicated the platform stopped making sense, so `claude-kit-pro` was folded into
this repo and archived on 2026-07-11. Everything it had — quality, ralph, strategy,
sota, steward, review, backlog, the domain skills, all 14 agents — is here, MIT.

The old three-tier chain (setup → kit-pro → kit) is collapsed. There is no "core
layer" and no "pro"; there is just the kit.

### Fixed — the installer was silently broken

`install.sh` symlinked `commands/`, `skills/` and `agents/` into `~/.claude/` but
**not `scripts/`** — while `config/settings.json` wires 14 hooks to
`$HOME/.claude/scripts/*.sh`. Every hook (including the `block-push-main` and
`block-commit-main` safety rails) silently no-opped for anyone who installed from a
clean clone. One missing word in a `for` loop.

- `install.sh`: link `scripts/` as well (#—)
- `scripts/setup-claude-sync.sh`: **added**. Six files referenced this script and it
  did not exist; `/bs:sync`, whose entire job is repairing symlinks, invoked it. It
  now exists, links all four directories, and verifies every hook named in
  `settings.json` actually resolves. `--check` exits non-zero when they don't.
- `skills/ralph/SKILL.md`: `SCRIPT` was built from `$SETUP_REPO`, a variable that is
  never set — so ralph's runner path resolved to `/scripts/ralph-next-run.sh` and
  failed for everyone. Now resolved through the standard candidate chain.
- `commands/bs/sync.md`: same `$SETUP_REPO` bug.

### Fixed — hardcoded maintainer-only paths

`skills/quality/SKILL.md` and `skills/ralph/SKILL.md` fell back to
`$HOME/Projects/products/claude-kit/...`, a path that exists on exactly one machine.
Removed; the chain now ends at `$HOME/.claude/scripts/`, which the installer creates.
This is the rule CONTRIBUTING.md already stated and the repo was violating.

### Changed — tightened default Bash permissions (BREAKING)

`config/settings.json` listed a bare `"Bash"` in `permissions.allow`, which
auto-approved **every** shell command and effectively neutered the `deny` and `ask`
rules below it. Removed. The allow-list now only covers the specific read-only
patterns (`Bash(**/grep *)`, `Bash(**/cat *)`, …).

Expect prompts for Bash commands that previously ran unprompted. That is the point —
widen the allow-list in your own `~/.claude/settings.json` if you want it back.

### Fixed — CI hostile to contributors

- `.github/workflows/cascade-to-pro.yml`: **removed**. It fired on every push to
  main, dispatching to `claude-kit-pro` — now archived and private. It failed every
  time, leaving a permanent red ✗ on the repo homepage, and advertised a private repo.
- `.github/workflows/stale-prs.yml`: this auto-closed **any** PR after 48 hours. It is
  a solo-maintainer discipline hack and it was pointed at the public: a first-time
  contributor opening a PR on Friday would have it closed by Sunday. Now scoped to
  PRs explicitly labelled `maintainer`; community PRs are invisible to it.

### Fixed — dangling command references

`/bs:post`, `/bs:maintain`, `/bs:resume` and `/bs:context` were referenced in shipped
docs but ship in no version of the kit (the first two are private; the latter two were
removed). `/bs:workflow` — the guide the README points newcomers at — told them to run
commands that do not exist. All 44 referenced `/bs:*` commands now resolve.

### Fixed — version skew

`plugin.json` said 3.0.0, `package.json` said 1.2.1, the latest tag said v2.2.0.
Now uniformly 3.0.0.

## [1.2.1] - 2026-05-17

### Fixed

- `commands/bs/quality.md`: removed an unsafe cleanup-cron example that suggested a periodic find-and-delete rooted at the `$TMPDIR` variable. Even bounded by `-name` and `-mtime` filters, deleting through a shell-resolved path matches the dangerous-pattern rule documented in CLAUDE.md (filesystem-safety policy, 2026-04-19 incident). The OS reclaims `$TMPDIR` on its own schedule, so no user-level cron is needed (#42).

## [1.2.0] - 2026-05-16

### Repositioned

claude-kit is now positioned as a **complete OSS Claude Code toolkit**, not "the free core layer that pro extends." Most devs won't need anything beyond it. Pro (claude-kit-pro) is a different category — autonomous workflow + commercial intelligence + license enforcement — not "more features."

The full kit↔pro de-duplication arc landed across 5 PRs (#36–#40). Items that weren't truly commercial or pro-only moved into kit:

### Added

- **`quality` skill — full body absorbed from pro** (#36): tier classification (`--level auto`, `harness-config.json` risk routing), Codex cross-review (`--codex-effort`, `--codex-skip`, `--no-codex`), break-glass approval for critical tier, agent panel mapping, `--background`/`--wait` flags, full `--target-dir` PR/branch/worktree resolver. Was previously a forked pro-only superset; now lives in kit canonically. `reference.md` and `checklist.md` also added (kit was missing both).
- **`scripts/quality-target-resolver.js`** (410 lines) + **32 tests** (#36) — full PR / branch / worktree-path resolution moved from the claude-setup overlay so kit-only users get the full target resolver, not just the legacy `--target-dir` parser.
- **`skills/healthcheck`: `model: haiku` frontmatter** (#36).
- **Basic-hygiene skills** (#37): `cost`, `deps`, `status`, `workflow` skills + `bs:cost`, `bs:deps` commands. License gates stripped on the kit copies. Pro's overrides deleted.
- **Sticky-funnel skills** (#38): `frontend-design` (Apache 2.0, Anthropic-original), `ui-reviewer` (Brett-authored), `webapp-testing` (Apache 2.0, Anthropic-original Playwright toolkit), `visualise` (Brett-authored). LICENSE.txt files preserved on the Apache 2.0 skills.
- **6 generic SWE agents** (#39): `accessibility-tester`, `architect-reviewer`, `performance-engineer`, `postgres-pro`, `prompt-engineer`, `refactoring-specialist`. Joining the existing 2 (`code-reviewer`, `security-auditor`) for **8 total SWE agents**.
- **2 dev-hygiene commands** (#39): `bs:investigate`, `bs:init-project`. License gates stripped.
- **README rewritten** (#40): 15-row tier comparison table, lists all 14+ skills with one-liners, dedicated Agents section, "When you might want pro" section that honestly tells readers when they don't need pro.

### Fixed

- **Drift hazard for 5 duplicated items eliminated** (#36): `skills/quality`, `skills/healthcheck`, `skills/recover`, `agents/code-reviewer`, `agents/security-auditor` had been forked between kit and pro with 782 lines of divergence on quality alone. Kit absorbed pro's canonical versions and pro deleted its copies.

### Changed

- **`tests/__tests__/quality-target-resolution.test.js`** runs under Vitest as part of the standard suite (32 tests, all green).

## [1.1.0] - 2026-05-15

### Added

- **`scrub` skill** — `/bs:scrub` is now backed by `skills/scrub/SKILL.md` and auto-invokes on natural language ("prep this for open source", "scrub for release", "clean before publishing", "prep for giveaway", "prepare commercial release"). The 334-line implementation moved from a top-level command file into a proper Skill, matching the same pattern used by `/bs:quality`, `/bs:ralph`, and `/bs:dev`. Slash-command users can still call `/bs:scrub` directly; the file at `commands/bs/scrub.md` is now a thin shim that invokes the skill.

### Fixed

- **`skills/scrub`: Phase 9 release block restored** — the original `commands/bs:scrub.md` had a `Phase 9: Version Bump + GitHub Release` step (auto-bumps `package.json`, tags, runs `gh release create`). It was missing from the initial skill conversion; restored verbatim so the documented end-to-end "scrub + cut release" flow works.
- **`skills/scrub`: hardened submodule deletion example** — the previous `git submodule deinit` walkthrough included a `rm -rf .git/modules/<path>` snippet that would trip the filesystem-safety hook. Rewrote to require explicit literal-path resolution, repo-boundary check, and user confirmation before any deletion.
- **`skills/quality`: persist git root through forked Bash blocks** — `--target-dir` now survives skill forks (#33).
- **`skills/quality`: arg propagation across fork boundary** — `$ARGUMENTS` now persists via a tempfile bridge (`--args-file`), so flags reach the forked skill reliably (#26).
- **`skills/quality`: auto-select scope+level from diff size and risk tier** (#30), with a coaching note when `--scope changed` is the right call for tiny critical/high-tier changes (#31).

### Removed

- **`commands/bs:scrub.md`** (top-level, colon-prefix variant) — superseded by `commands/bs/scrub.md` + `skills/scrub/`.

## [1.0.6] - internal

Version bumped in #32; no CHANGELOG entry written at the time. Covered by 1.1.0.

## [1.0.5] - internal

Tag without a CHANGELOG entry. Covered by 1.1.0.

## [1.0.4] - 2026-05-06

### Fixed

- Add the missing `.semgrep/defensive-patterns.yaml` config so `npm run security:scan:ci` works for release checks.
- Wire Husky `pre-commit` and `commit-msg` hooks to match the documented lint-staged and commitlint workflow.
- Tighten `knip.config.js` to the actual source layout so `npm run dead-code:strict` passes.
- Apply Prettier formatting to release-facing templates, `SECURITY.md`, `/bs:scrub`, and the agent dashboard server.

### Removed

- Remove unused `fast-check` dev dependency.

## [1.0.2] - 2026-04-19

### Fixed

- **`skills/quality/`**: remove Codex Cross-Review section (requires paid ChatGPT subscription — belongs in claude-kit-pro). Fix acpx 0.5.3 syntax in the Parallel Sub-Review block — the old syntax (`acpx claude exec --no-wait`, `acpx status`, `acpx output`) had not worked since acpx 0.5.3, so `/bs:quality --parallel` silently fell back to sequential. Now uses the correct `sessions new` → `prompt --no-wait` → `sessions read` flow with history-based completion detection.
- **`commands/bs/dev.md`**: remove `--alt` Second Opinion mode (Codex-based, paid tier).
- **`skills/quality/reference.md`**: drop `--no-codex` flag and `CODEX_TIMEOUT` env var.
- **`skills/quality/checklist.md`**: drop the "Claude AND Codex" confidence-boost line.

### Removed

- **`scripts/risk-policy-gate.js`** (+ its tests, stryker config, and the Harness Policy Gate workflow). The scrub that created v1.0 removed the required `harness-config.json`, leaving an always-failing workflow on every PR. `quality.yml` is the primary CI gate.
- **`mcp-servers/dataforseo-mcp-server/dist/`** — 380K of compiled 3rd-party JS with no source, LICENSE, or attribution. Free-tier users cannot use it anyway (needs paid DataForSEO credentials).
- **`mcp-servers/twitter-mcp-server/`** — only a rate-limit cache file, no source/LICENSE.
- **`scripts/run-dataforseo-mcp.sh`** — now-orphan wrapper.
- **Stryker mutation testing**: config + package.json scripts + deps. Only mutated the removed `risk-policy-gate.js`.

### Added

- **Pull-request CI**: `quality.yml` now triggers on `pull_request` (lint-and-format + test jobs). Previously PRs had zero automated CI after the Harness Policy Gate workflow was removed.
- **`.defensive-patterns.json`**: exclusion config for `eslint-plugin-defensive/` (self-referential false positives — its rule definitions contain the patterns they describe) and `mcp-servers/*/dist/`.

### Chore

- Prettier auto-format across 80 files (non-semantic — repo's existing prettier config applied).

## [1.0.1] - earlier

Initial public release cycle.

## [1.0.0] - 2026-04-12

Initial public release of claude-kit (renamed from claude-power-kit).
