# Security Specification - FinanTech

## Data Invariants
- A contract belongs to an `ownerId`.
- A user can only read/write their own contracts (if explicitly shared, but for now we assume owner only).
- A transaction must belong to a contract and can only be created by the contract owner.
- Fixed config once created should be immutable or only updatable by admins (though we don't have admins yet, we'll restrict updates to sensitive fields).
- All amounts must be positive.
- Installment numbers must be within valid range (1-240).

## The Dirty Dozen Payloads

1. **Identity Spoofing**: Attempt to create a contract for another user.
2. **Identity Spoofing**: Attempt to read/list contracts of another user.
3. **Identity Spoofing**: Attempt to delete another user's transaction.
4. **Data Poisoning**: Attempt to set an installment number to a string.
5. **Data Poisoning**: Attempt to set a negative payment amount.
6. **Data Poisoning**: Attempt to inject a 1MB string into a notes field.
7. **Privilege Escalation**: Attempt to change `ownerId` of a contract.
8. **Relational Breach**: Attempt to add a transaction to a contract I don't own.
9. **Relational Breach**: Attempt to read transactions of a contract I don't own.
10. **State Shortcutting**: Attempt to change the `createdAt` timestamp to a backdated time.
11. **PII Leak**: Attempt to list all users' contracts via blanket query.
12. **Quota Exhaustion**: Attempt to create 10,000 transactions in a loop (handled by rules via `exists()` or size checks).

## Test Spec (Draft)
The tests should verify:
- `allow read: if isSignedIn() && resource.data.ownerId == request.auth.uid`
- `allow write: if isSignedIn() && request.resource.data.ownerId == request.auth.uid`
- Sub-collections inheritance: `get(/databases/$(database)/documents/contracts/$(contractId)).data.ownerId == request.auth.uid`
