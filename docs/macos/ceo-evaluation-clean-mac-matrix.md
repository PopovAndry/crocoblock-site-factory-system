# macOS CEO Evaluation verification contract

This contract records work that must run on real Macs. Configuration or tests
on Windows do not satisfy any runtime case below. Every case is currently
**NOT RUN**.

The application name is **Crocoblock Site Factory**. The provisional bundle
identifier is `com.crocoblock.sitefactory`; both require release-owner approval
before signing.

## Clean-Mac matrix

| Case | Initial state | User actions | Expected visible result | Technical evidence | Cleanup/reset | Blocker | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A. Apple Silicon ready | Fresh supported arm64 Mac; Docker running; approved package bundle available | Install DMG, open app, run System Check | System ready | App log summary, Docker response, System Check screenshot | Quit app; remove disposable app data and project created by this case | Yes | NOT RUN |
| B. Apple Silicon, Docker absent | Fresh supported arm64 Mac without Docker | Open app, follow official Docker action, install and start Docker, recheck | Action required becomes System ready | Docker detection before/after and screenshots | Uninstall Docker only on the dedicated test Mac; remove disposable data | Yes | NOT RUN |
| C. Apple Silicon, Docker stopped | Supported arm64 Mac with Docker installed but stopped | Open app, start Docker Desktop, recheck | Installed-but-stopped guidance becomes System ready | Distinct Docker detected/daemon states | Quit Docker and remove disposable data | Yes | NOT RUN |
| D. Intel ready | Fresh supported x64 Mac; Docker running | Install x64 DMG, open app, run System Check | System ready | Architecture identity, signature and readiness evidence | Remove disposable app data and project | Yes | NOT RUN |
| E. Insufficient resources | Supported Mac below disk threshold or memory recommendation | Open app and run System Check | Disk is Action required; memory is a clear warning | Bounded disk/memory evidence and screenshot | Restore test allocation; remove disposable data | Yes for disk; no for memory warning | NOT RUN |
| F. Fresh application data | No prior Site Factory application data | Open app once | App creates only standard user-owned support/cache/log locations | Directory inventory and permissions without credential content | Remove only directories created for this case | Yes | NOT RUN |
| G. Reopen after creation | One disposable site successfully created | Quit and reopen Site Factory | Existing project remains listed and opens | Project identity/count before and after restart | Remove disposable project through the approved later cleanup process | Yes | NOT RUN |
| H. Gatekeeper DMG | Downloaded release DMG on a clean Mac | Open DMG and launch copied app normally | No unidentified-developer or damaged-app warning | `spctl` assessment plus visible launch evidence | Eject DMG and remove app | Yes | NOT RUN |
| I. Signature | Release `.app` and DMG | Inspect signing chain | Developer ID Application identity and hardened runtime are valid | `codesign --verify --deep --strict --verbose=2` output | None | Yes | NOT RUN |
| J. Notarization ticket | Notarized release DMG | Validate staple offline/online as appropriate | Stapled ticket is accepted | `xcrun stapler validate` output | None | Yes | NOT RUN |
| K. Zero-to-site | Clean supported Mac, prerequisites resolved | Install, open, pass System Check, create Real Estate site, open it | Complete live site without Terminal or developer repair | Operation terminal states, health, browser proof, restart proof | Remove only the disposable project after evidence capture | Yes | NOT RUN |
| L. Real Estate journey | Successful disposable K site | Navigate Homepage, Archive, Single, Contact on desktop and mobile widths | Complete readable customer journey | Sanitized screenshots and URL status evidence | Included in K cleanup | Yes | NOT RUN |

## External prerequisites

- Apple Developer team access.
- Developer ID Application certificate available through the macOS keychain.
- A preconfigured `notarytool` keychain profile or another approved external
  notarization authentication method.
- Final approval of the bundle identifier and application name.
- An Apple Silicon test Mac.
- An Intel Mac or a real Intel tester.
- An approved Crocoblock evaluation-package distribution channel.
- A Docker Desktop company licensing decision. Site Factory does not determine
  licensing eligibility.
- An approved `.icns` application icon supplied outside source until approved.

## Package source deployment options

The trusted resolver supports either release-time injection into the read-only
app resources or a separately approved managed bundle in application data.
Neither option permits browser-supplied paths. Product and legal owners must
approve the distribution model before proprietary archives are included in an
evaluation package. Validation, quarantine, hashing, WordPress identity checks,
and the managed cache remain mandatory after source resolution.

## Release commands on macOS

Evaluation commands require `APPLE_DEVELOPER_IDENTITY` and an externally
configured `APPLE_NOTARY_KEYCHAIN_PROFILE`. Missing prerequisites stop the
build; release commands never fall back to unsigned output.

```sh
cd launcher
npm run validate:mac-package
npm run package:mac:arm64
npm run package:mac:x64
npm run verify:mac-package -- /path/to/Crocoblock-Site-Factory.dmg
```

Internal unsigned packages are visibly named `UNSIGNED-ENGINEERING` and can be
created only through the explicit `package:mac:*:unsigned-engineering` scripts.
They are not CEO evaluation artifacts.
