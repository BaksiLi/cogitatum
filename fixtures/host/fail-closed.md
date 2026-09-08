# Incident note

The first source unit contains one malformed operator clause.

```cog
- Service failure
  - [C @cause] The cache is returning stale data.
    - [G @logs] Logs contain outdated version markers.
    - [edge @logs, not-a-ref +> @cause; @bad-route] This route is malformed.
```

Host prose remains available to the host application.

```cog
- Independent follow-up
  - [Q @next] What should be verified?
    - [C @check] Compare cache and origin version headers.
```
