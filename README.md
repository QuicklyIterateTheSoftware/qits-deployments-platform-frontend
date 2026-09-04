# qits-deployments-platform-frontend

The CD explorer: what is deployed where, served by qits-deployments itself at the root of
`deployments.<env>.<domain>` through Quinoa. One screen, no forms — and exactly two writes, which
are operations on a running application rather than changes to the catalogue.

- **`/`** (and `/<projectSlug>/`) — deployments by project. Projects (from qits-projects) → the cd
  environment each project's slug names → a table of that environment's applications and what is
  currently deployed on each. The page itself makes two requests, both flat lists; expanding a
  project costs three more (the environment's applications, its deployments, its deployment
  requests) and caches. Expansion is carried in the query parameters (`?project=…`), so it is
  bookmarkable and the back button collapses.

## The two levers

Each row carries **Restart**, and **Stop**/**Start**. They exist because of a real incident: qits-ci
wedged behind a healthy probe, and the only way to replace its container was re-firing a same-sha
push to `environment/dev` and waiting a quarter of an hour for a rebuild.

- **Restart** bounces the tasks in place — same image, same deployment, no new row. The service
  stamps the deployment's `detail` with who did it and changes nothing else.
- **Stop** scales the application to zero tasks and is asked twice: it takes an application off the
  platform, so the confirmation is inline and names the row. The row then reads **Stopped**
  (`SCALED_TO_ZERO`), a warning rather than a danger tone — somebody did it on purpose — and offers
  **Start** in place of the other two.
- **Start** scales it back to one. The row keeps saying *Stopped* until qits-deployments' own
  observation finds the tasks healthy, which is up to one observation interval later. That wait is
  deliberate here: the service reaches a health verdict in exactly one place, and this page must not
  invent a completion it never promised.

All three answer **202** — every orchestrator call runs on one worker behind whatever is deploying —
so the page re-reads the environment after each and believes nothing about the response. There is
no separate plane to read back: a platform service's rows are in the tier it deploys into, so the
table the lever was pressed from is the table that answers. A row whose deployment never reached
the orchestrator (`IMAGE_MISSING`, and anything else with no container name) draws no lever at all:
there is no service to act on and the API answers 409.

The levers take `qits-platform:admin`, the same role every read here does: this is a person's
operational action through the platform edge's forwarded header, and a machine token opens neither.

## The project in the address

This app is **project scoped**: `/qits` is the same page as `/`, with the address stating which
project the reader is inside. That does one visible thing — it **seeds the expansion**, so the
scoped project's row is already open on arrival. It is a seed and not an override: `?project=` is
still the reader's statement, and a scoped row can be collapsed like any other (collapsing the last
one writes an empty `?project=`, which is what stops the seed reopening it).

The scope is read from the address by `@qits/ui-components` (`provideQitsScope('project')`), never
from a route parameter, so one component serves both forms.

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
carries a `runId` the commit cell links to qits-ci's run page — a plain `href`, because that is
another application on a host of its own and this SPA's router owns nothing outside this one. The
address comes from `QitsAppLinks`, which reads the platform's own navigation, and falls back to the
old `/ci/` segment on the environment origin for as long as qits-ci has no host of its own.

## The lifecycle a row shows

A deploy is driven by a `SoftwareRelease` now, and the row follows what that produces: **request →
gate → deployment**. The **Version** column is the CalVer coordinate the release minted — the git
tag, and the tag the image carries — because that is what identifies a deployment; the commit
beside it is what the tag resolved to and may be absent, which is a real answer and not a gap.

`GET /platform-deployments/api/deployment-requests?environmentId=…` is the third read an expansion
makes, and it exists because a request the quality gate refused **queues no deployment at all** —
there is no row in the deployments listing that could show it. Where the newest request is not the
deployment on the row, the version cell says so (`→ 2026.903.12 · gate unmet`), and the row's
expansion lists every version asked for here with the gate's verdict and its reason. The gate is a
placeholder that says yes to every released version today; the screen is written against both
answers so that the first real refusal is visible the day it happens rather than a change later.

A failed request read does not take the table down with it — it is drawn without them, behind a
line naming what is missing. The table is still exactly what the service said ran.

## Platform services

There is no "Platform services" section, and its absence is deliberate. There was one, and it was
right while a platform service belonged to no environment at all: no project and no tier could lead
to it. A platform service is deployed **into the designated environment** now and its deployment
rows name that tier, so it is one more row in that environment's table, carrying a quiet `platform`
tag that says the one thing still true of it — it is linked into no environment, which is why one
release of it reaches every tier at once.

The catalogue still cannot list them through the environment (a platform service holds no link, on
purpose, so a tier created tomorrow picks it up), so they come off the flat
`GET /platform-deployments/api/applications` and are merged into the one environment whose
`platform` flag says the plane deploys there. That fourth request is made for that environment only.
An install with no environment designated deploys nothing anywhere, and the page says so in a
banner — the one fact about this screen that no row can state.

The base path is `/`: qits-deployments serves this app at the root of its own host, so `baseHref`
here spells no segment at all. The `/platform-deployments` segment survives only as that service's
wire prefix, in three of its keys (`quarkus.quinoa.ignored-path-prefixes`, `quarkus.rest.path`,
`quarkus.http.non-application-root-path`) and its `routes:` line — all of them in that repository.
The Angular project, the package and the type names still say `cd`; only paths moved.

The page polls only while a visible deployment is `QUEUED` or `STARTING` — or a visible request is
still in its gate — every five seconds, and stops on the first settled answer; a hidden tab polls
nothing. It re-reads the deployments and the requests and never the catalogue: what an environment
tracks does not change while a container starts. A settled table is refreshed by the button and by
nothing else.

`src/app/api/` holds hand-written interfaces mirroring the two services' wire shapes, one injectable
service each, over `HttpClient` on the fetch backend. Nothing is generated, and nothing is shared
with qits-ci-frontend: the duplication is the deliberate alternative to putting transport into a
components library that six SPAs consume without making a request.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

`proxy.conf.json` forwards `/platform-deployments/api`, `/projects/api` and `/main-navigation` to
an edge on `localhost:8080`, because `ng serve` puts no edge in front and the screen reads across
two services. In a deployment every call is a same-origin path on this service's own host — the
edge path-routes every application's segment on every vhost — which is what carries the session
cookie.

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
