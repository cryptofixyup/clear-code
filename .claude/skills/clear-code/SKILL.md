```markdown
# clear-code Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `clear-code` TypeScript repository. It covers file naming, import/export styles, commit message conventions, and testing patterns, providing practical examples and command suggestions for efficient collaboration and code quality.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userProfile.ts`, `dataFetcher.test.ts`

### Imports
- Use **alias** imports for modules.
  - Example:
    ```typescript
    import { fetchData as getData } from './dataFetcher';
    ```

### Exports
- Use **named exports**.
  - Example:
    ```typescript
    // In utils.ts
    export function calculateSum(a: number, b: number): number {
      return a + b;
    }

    // In another file
    import { calculateSum } from './utils';
    ```

### Commit Messages
- Follow **conventional commit** format.
- Use `feat` as the prefix for features.
- Keep commit messages concise (average 60 characters).
  - Example: `feat: add user authentication middleware`

## Workflows

### Commit Feature
**Trigger:** When adding a new feature or significant code change  
**Command:** `/commit-feature`

1. Make your code changes following the coding conventions.
2. Stage the changes:  
   ```
   git add .
   ```
3. Commit using the conventional format:  
   ```
   git commit -m "feat: concise description of the feature"
   ```
4. Push your changes:  
   ```
   git push
   ```

## Testing Patterns

- Test files use the pattern `*.test.*` (e.g., `userService.test.ts`).
- The specific testing framework is unknown, but tests should be colocated with the code or in a dedicated `tests` directory.
- Example test file structure:
  ```typescript
  // userService.test.ts
  import { getUser } from './userService';

  describe('getUser', () => {
    it('returns user data for a valid ID', () => {
      // test implementation
    });
  });
  ```

## Commands
| Command          | Purpose                                         |
|------------------|-------------------------------------------------|
| /commit-feature  | Guide for committing new features or changes     |
```
