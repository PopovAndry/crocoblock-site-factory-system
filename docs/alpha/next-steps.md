# Recommended Next Steps

Recommended sequence after this alpha:

1. **Field-scoped planning**
   - preserve protected frontend fields automatically
   - reduce avoidable conflicts when only some fields should change

2. **Overwrite confirmation flow**
   - require explicit approval before protected frontend overrides are replaced
   - make conflict handling a real user workflow instead of a hard stop only

3. **Narrow field-only apply contract**
   - stop relying on the broader controlled generate mutation path for state apply
   - make apply scope more explicit and easier to reason about

4. **Drift detection v1**
   - compare State v1 expectations against the current generated site
   - surface managed drift before apply and rollback

5. **Live AI provider enablement behind cost and confirmation gates**
   - keep mock/local mode available
   - add provider, model, token, and confirmation controls before any live call path is enabled

6. **Stronger rollback and snapshot model**
   - move beyond safe personalization rollback
   - add better state/apply lineage and broader recovery coverage

7. **Demo and alpha UX polish**
   - make the proven flow easier to present
   - keep polish behind the already-proven product path instead of ahead of it
