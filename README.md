# QitsSpaCd

The CD explorer: the read-only view of what is deployed where, served by qits-deployments itself at
`/platform-deployments/` through Quinoa. One screen, no forms, no writes.

- **`/platform-deployments/`** — deployments by project. Projects (from qits-projects) → the cd
  environment each project's slug names → a table of that environment's applications and what is
  currently deployed on each. The page itself makes two requests, both flat lists; expanding a
  project costs two more and caches. Expansion is carried in the query parameters
  (`/platform-deployments/?project=…`), so it is bookmarkable and the back button collapses.

The project → environment edge is **`CdEnvironment.name === Project.slug`, and it is convention
only** — no column links the two services. So the page draws a match, never a foreign key, and shows
both kinds of non-match: a project whose slug names no environment says so on expansion (the usual
cause is qits-projects' `CdEnvironmentNotifier` having failed), and every environment no project
claims sits in an **`Environments matching no project`** bucket that is drawn even when it is empty.
Neither needs a service gap: `GET /platform-deployments/api/environments` returns everything, so
both orphan sets are a client-side difference.

A row's current deployment is the newest row for that application in a list the service already
sorted newest first; everything behind it is history and lives behind the row's own expansion,
together with the deployment's `detail` clob and its exact timestamps. There is no detail route,
because a deployment row already carries everything qits-deployments knows. Where a deployment
carries a `runId` the commit cell links to `/ci/runs/<runId>` — a plain `href`, because that is
another application behind the same gateway and this SPA's router owns nothing outside
`/platform-deployments/`.

The base path is `/platform-deployments/` — the segment qits-deployments serves this app at. It is
spelled in four places that must agree, three of them in that service
(`quarkus.quinoa.ui-root-path`, `quarkus.rest.path`, `quarkus.http.non-application-root-path`) and
the fourth here, in `angular.json`'s `baseHref`. The repository, the package and the type names
still say `cd`; only paths moved.

**One `/cd/` is left, and it is not ours.** `@qits/ui-components` still points its `CD` navigation
entry at `/cd/`, so no link is marked current in this app's sidebar until that entry moves. The fix
is one line in qits-spa-ui-components, and this app picks it up on its next release-train bump.

The page polls only while a visible deployment is `QUEUED` or `STARTING`, every five seconds, and
stops on the first settled answer; a hidden tab polls nothing. A settled table is refreshed by the
button and by nothing else.

`src/app/api/` holds hand-written interfaces mirroring the two services' wire shapes, one injectable
service each, over `HttpClient` on the fetch backend. Nothing is generated, and nothing is shared
with qits-spa-ci: the duplication is the deliberate alternative to putting transport into a
components library that six SPAs consume without making a request.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

`proxy.conf.json` forwards `/platform-deployments/api` and `/projects/api` to a gateway on
`localhost:8080`, because `ng serve` puts no gateway in front and the screen reads across two
services. In a deployment every call is a same-origin path behind the real gateway, which is what
carries the session cookie.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
