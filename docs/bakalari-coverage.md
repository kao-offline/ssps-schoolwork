# Bakaláři read coverage

Verified on 2026-10-01 against the connected student's SSPS account, through the built stdio MCP server. Only counts/availability are recorded here; no grades, names, attendance details, messages, documents or credentials are stored in the repository. Permissions and content can change by account/date.

| Area | Tool | Live result |
| --- | --- | --- |
| Profile and module rights | bakalari_capabilities / read_bakalari_data: profile | Accessible; 10 enabled app modules |
| Subjects and teachers | list_bakalari_subjects | 19 subjects |
| Lesson descriptions/topics/notes | list_bakalari_lesson_topics | All 19 subjects readable; 192 topic records |
| Current marks, weights, points, comments and official averages | read_bakalari_data: marks | Accessible; 3 subjects with marks |
| Historical report cards | read_bakalari_data: report_cards | Accessible; 3 certificate terms |
| Absences and percentages by subject | read_bakalari_data: absences | Accessible |
| Actual and permanent timetable | read_bakalari_data: timetable_actual / timetable_permanent | Both accessible; actual requires date |
| Lesson plans/content in timetable | Same timetable areas | Theme, WeekTheme, Notice and PlannedClasification fields preserved; values depend on school data |
| Substitutions and timetable changes | read_bakalari_data: substitutions | Accessible; 2 changes in tested window |
| School/my/public events | read_bakalari_data: events / events_my / events_public | Accessible; empty in tested responses |
| Homework, including content, notes, attachments and completion fields | list_schoolwork / read_bakalari_data: homeworks | Accessible; empty in tested date range |
| Received messages | list_announcements + get_bakalari_message | Accessible; 6 messages |
| Noticeboard | list_announcements: noticeboard | Accessible; 3 posts |
| Sent messages | list_announcements: sent + get_bakalari_message: sent | Accessible; empty |
| Message/homework attachments | read_document | Word attachment download and extraction verified |
| Personal consents and GDPR contact metadata | read_bakalari_data: consents / commissioners | Accessible; empty responses |
| Documents portal, confirmations, meetings, retake exams, drafts and portal messages | read_bakalari_web | Authenticated pages readable; server-rendered text only |
| Educational materials catalogue | read_bakalari_web: teaching_resources | Embedded catalogue supported; signed download links omitted |
| Surveys | read_bakalari_web: surveys / surveys_open / surveys_closed | Page and open/closed list endpoints readable; lists currently empty. Application-error payloads are reported as errors |
| Teacher classbook and lesson tags | read_bakalari_data: classbook / lesson_tags | HTTP 403; not available to this account |
| Disciplinary measures | read_bakalari_data: disciplinary_measures | HTTP 403 |
| Class fund and fund summary | read_bakalari_data: class_fund / class_fund_summary | HTTP 403 |
| Apology and rating message categories | list_announcements: apology / rating | HTTP 403 |

## Boundaries

This covers the documented mobile read API and selected authenticated web sections observed in the school's navigation. It does not promise every feature of every Bakaláři installation. New server routes must be inspected and added explicitly: arbitrary paths, methods and URLs are not accepted.

The Documents portal uses a nested DevExpress file manager. Current web reads show its server-rendered root/page, not a recursive folder listing or arbitrary document download. Existing message/homework attachments remain fully readable through read_document. Confirmations expose a client-rendered page; generating a new confirmation is a separate action and is not implemented. Survey list endpoints succeed and currently return no surveys; survey answering is not implemented. Educational resource catalogue metadata is accessible (3 school levels and 267 navigation entries); protected resource binaries are not downloaded by this release.

No teacher-only access, student switching, message sending, read receipts, grade confirmations, consent changes, homework completion, uploads or survey submissions are performed. The server's readOnlyHint remains true for every tool. Temporary web session cookies and one-time login credentials remain in memory, on the school's HTTPS origin, and are never returned to agents or saved to the repository.

## Verification

Run npm run check for lint, typecheck, build and tests, and npm run doctor for live account status. Start the MCP server from mcp.local.json and call bakalari_capabilities with probe=true plus an explicit date to recheck API availability. Check message categories and web areas independently: mobile API rights do not establish web-page/grid availability. Chunked reads include a content hash to detect data changes during pagination.

On this revision, lint, typecheck, build, all 11 tests, skill validation and dependency audit passed locally. Tests cover module allowlists, leading-space subject IDs, date-filtered lesson topics, permission failures, coherent JSON chunks, temporary web sessions, application errors and suppression of hidden/signed credentials. No Git remote, PR or remote CI run is configured. The local MCP entrypoint is dist/index.js; restart an existing client process to load the expanded tool list.
