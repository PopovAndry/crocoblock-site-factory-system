# Controlled Request Viewing before-state v1

This disposable-runtime fixture supplies exactly two server-side business policy checks for the Factory-owned Request Viewing form:

1. at least one non-empty scalar `email` or `phone` value;
2. a submitted numeric `property_id` resolving at submission time to a published WordPress `property` post.

`factory-request-viewing-before-v1-policy.php` is loaded as a WordPress mu-plugin. Its binding option must contain exactly the Factory-owned form ID, its saved content SHA-256, the approved field names, and the non-business hidden `text-field` guard used to invoke the two JetFormBuilder server-side rules. A missing, malformed, ambiguous, retargeted, or corrupted binding fails closed whenever either callback is invoked. The module registers no global WordPress hook or validator: unrelated forms do not invoke either callback unless their own JFB field configuration explicitly names it. The callbacks resolve fields through JetFormBuilder's native parser context before reading them, so their result does not depend on field processing order.

`bootstrap.php` is a WP-CLI-only helper. It refuses to run unless the runtime option binds it to `csf-st-viewing-before-v1`; its mode is supplied through the `FACTORY_REQUEST_VIEWING_BEFORE_V1_MODE` environment variable. `base` creates the controlled Contact page, two published `property` posts, and negative-control posts. `controls` creates exactly two additional Factory-owned negative controls: one private `property` and one trashed `property`. Each is pinned by a stable control marker and original slug marker; reruns reuse only the same owned control and fail closed on a duplicate or conflict. `form` creates the native JetFormBuilder form, binds its saved-content hash, configures only native Form Records, and installs the Property-to-Contact CTA. It does not create a preferred-date field, delivery action, custom endpoint, or records subsystem.

Runtime evidence must record the policy file SHA-256, version, mu-plugin load location, form ID/content hash, and the field bindings. The fixture remains a preservation dependency for a later Site Transaction; it is not production-generator code.

`launcher/test/php-request-viewing-before-fixture.php` loads the real policy and bootstrap functions with narrow WordPress/JFB doubles. It proves the binding fail-closed cases, approved contact/property inputs, no global hook registration, and the distinction between a WordPress `any` lookup and the explicit `trash` lookup required by the idempotent controls probe. These are source-level behavioral regressions; the disposable runtime remains the required evidence for JFB submission behavior.
