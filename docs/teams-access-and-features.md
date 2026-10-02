# Teams access routes and feature map

The user subsequently authorized live automation. The selected route is now the dedicated Chrome integration described in [Live Teams in Hermes](teams-live-browser.md). The extension and feature map below document the earlier offline fallback; they do not describe the live browser's capabilities. Live school class navigation, an assignment detail/deadline, teacher posts and expanded replies, and downloading/reading an assignment PDF were subsequently verified through Hermes. The remaining areas still need their own sample checks; this was not a complete history crawl.

Investigated 2026-10-02. The connected student reported administrator approval on the Graph PowerShell sign-in attempt, which requested only User.Read. The process then exited with an EventSource listener error. No Teams API data was retrieved. Opening the ordinary Teams web app in the shared browser reached /error/eoa; page snapshots failed twice. This is not evidence that Teams is disabled for the account or that its class data is empty.

## Route implemented without Microsoft API consent

The local extension in browser/teams-capture captures text only after the student clicks its button on a page they opened themselves. It uses activeTab and scripting, not persistent host access. Sign in to ordinary Teams in Chrome or Edge, open a homework detail or channel thread, expand the relevant content, then capture. Selected text takes priority; otherwise the collector reads the main frame's rendered main region. There is no automated clicking, scrolling, navigation, background sync, cookie/token extraction, or network request in the extension.

This route does not request an Entra consent grant, but it depends on being able to use Teams normally and install an extension. Managed-browser policies can prohibit unpacked extensions. It does not bypass those policies. A school browser policy or conditional-access rule may still prevent use. Capture files contain private schoolwork text: keep them local and review before sharing. Exported JSON is plaintext; imported copies use the server's existing DPAPI protection on Windows (private file permissions on other platforms). The source page URL omits queries/fragments; it may identify the page rather than a unique assignment or post.

Setup:

1. Open chrome://extensions or edge://extensions in your own browser. Enable Developer mode, choose Load unpacked, and select the repository's browser/teams-capture directory. No Windows administrator installation is needed when browser policy allows this.
2. Open Teams normally and sign in with your own school account. Open the specific content; for embedded notebooks, try opening the notebook directly on a supported OneNote/SharePoint host. Office document viewer hosts and cross-origin frames are not captured by this version.
3. Click the extension, choose Capture this page, review the preview, and download the JSON. A selection lets you exclude surrounding personal conversation. Rendered text can include loaded off-screen content; it is not a screenshot.
4. From the repository, run npm run build, then npm run import:teams -- "C:/path/to/teams-capture-123.json". Only a validated text snapshot is imported. Additional/unknown fields, signed/query URLs, oversized files and claims of complete coverage are rejected. Identical snapshots deduplicate.
5. Restart the agent's MCP connection. Use list_captured_teams_context and read_captured_teams_context. Read every nextOffset chunk, passing expectedContentHash. Importing does not make connection_status report Teams connected.

Capture records remain until explicitly removed from the local data directory. npm run logout removes login credentials only, not captured schoolwork. Do not share ~/.ssps-schoolwork or downloaded captures. Each student imports their own material into their own local server.

## Feature map

"Capture" below means text only if it is rendered in the supported page's main frame. It is a partial user-provided snapshot, not a claim of authenticated structured API coverage. None of these features has been verified against this student's live Teams data.

| Feature | Current Graph connector | Capture route | Remaining limits |
| --- | --- | --- | --- |
| Classes/teams | list_classes | Loaded names/sidebar or selected text | No complete roster or stable class IDs from snapshots |
| Channels | list_channels | Loaded names | Hidden/archived channels require opening them yourself |
| Homework/project instructions | list_schoolwork, get_assignment | Open assignment detail | No automatic enumeration or structured assignment ID |
| Deadlines, closing time, late work | Assignment dueAt/closeAt | Exact displayed text | Agent must interpret displayed locale/timezone; do not invent normalized timestamps |
| Announcement posts | list_announcements | Open channel | Only loaded posts, no full history search |
| Teacher replies/corrections | get_thread | Expand thread first | Unloaded replies absent; opening Teams can trigger its normal read receipts |
| Assignment resources | get_assignment resource metadata | Displayed resource names/text | Does not fetch linked documents or grant link access |
| Files/Class Materials | resolve_document_link, read_document | SharePoint listing/preview text | No recursive listing or binary download; use normal download/export or OneDrive sync separately |
| PDF/Word/PowerPoint document content | read_document supports PDF, DOCX, PPTX, text | Only when text is rendered in a supported main frame | Office viewer frames/canvas/scans often require downloading the file and giving it to the agent separately |
| Student submission state | Not exposed yet | Open assignment status | No turn-in, undo, uploads or edits |
| Marks/feedback/rubrics | Not exposed yet (current OAuth request includes EduAssignments.Read) | Open returned assignment/Grades detail | Only the student's displayed feedback; no grade changes |
| Classwork modules/resource order | Not exposed yet; separate education curricula API/permission | Expand modules | No complete module catalogue; links are not followed |
| Lesson content / Class Notebook | Not exposed yet | Open supported OneNote page directly, or select rendered text | Embedded frames/ink/images excluded; normal export remains separate |
| Calendar / meetings | Not exposed yet | Displayed Teams calendar/event text | No calendar sync, reminders or attendance reports |
| Personal/group chats | Not exposed yet | Open a relevant school chat | Only loaded/selected text, unrelated chats not automatically collected |
| Activity, mentions, search results | Not exposed yet | Displayed results | Search is performed by the student, not by the extension |
| Forms/quizzes, Lists, Planner, other tabs | Not exposed yet | Only rendered text on supported hosts | External apps, iframe content and answering/submitting are unsupported |
| Recordings/transcripts | Not exposed yet | Loaded transcript text on supported hosts, if any | No media download, transcription or audio capture |
| Live refresh/full schoolwork sync | Graph routes implemented but not connected | Recapture and import | No background refresh or completeness guarantee |

## Other routes investigated

| Route | Approval/authentication requirements | Fit for this project |
| --- | --- | --- |
| Graph delegated app / Graph PowerShell | Normal OAuth plus tenant consent policy. Even EduAssignments.ReadBasic requires admin consent | Existing implementation, currently blocked; reducing grade access does not remove assignment consent |
| Teams resource-specific consent (RSC) | An installed Teams app and permitted resource owner/installer; tenant controls still apply | Can grant ChannelMessage.Read.Group for one team. This is an application RSC permission, not a delegated Graph replacement. Requires a different Teams app/backend architecture. No education-assignment RSC permission appears in the supported list |
| Ordinary Teams web session | Student's normal Teams sign-in and conditional-access rules | Capture uses the data the student already opened; isolated automated traversal would be a different mode, contrary to the requested no-browser-automation constraint |
| Unofficial internal API clients | Teams-specific session tokens and undocumented endpoints | Investigated, not installed or tested with school credentials. fossteams/teams-api declares incomplete coverage and uses a separate Electron token-capture app. roshank8s/teams-api targets teams.live.com (consumer Teams), so it is not evidence of school assignments support. Neither establishes an assignment-capable, browser-free sign-in path for SSPS |
| OneDrive/SharePoint sync or ordinary downloads | User's existing permitted file access; school may restrict sync | Useful for documents only, not assignment database, channel history, grades or replies. No sync client installed/configured by this change |
| Existing AI Teams connector | Connector's app approval and actual exposed tools | Could help if already permitted, but not a way to guarantee removal of school consent requirements or portable MCP assignment coverage |

There is no verified route here that automatically reads every Teams education feature while satisfying all three constraints: no administrator involvement, no browser automation and no manual capture. The implemented route satisfies the interaction constraints with explicitly partial context. A first-party session alone does not establish that an arbitrary Graph application has the required permission.

## Sources and validation

- [Graph assignment-list permissions](https://learn.microsoft.com/en-us/graph/api/educationclass-list-assignments?view=graph-rest-1.0) and [permission reference](https://learn.microsoft.com/en-us/graph/permissions-reference#eduassignmentsreadbasic).
- [Teams RSC permissions and modes](https://learn.microsoft.com/en-us/microsoftteams/platform/graph-api/rsc/resource-specific-consent) and [RSC grants](https://learn.microsoft.com/en-us/microsoftteams/platform/graph-api/rsc/grant-resource-specific-consent).
- [Teams assignments, grades and Classwork](https://learn.microsoft.com/en-us/microsoftteams/expand-teams-across-your-org/assignments-in-teams), [Class Notebook](https://support.microsoft.com/en-us/education/teams/use-class-notebook-in-teams), and [student export](https://support.microsoft.com/en-gb/education/onenote/students-export-a-copy-of-your-work-from-onenote-class-notebook-teams-and-onedrive).
- [SharePoint/Teams sync](https://support.microsoft.com/en-us/sharepoint/sync/sync-sharepoint-and-teams-files-with-your-computer).
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).
- Project-author sources: [fossteams/teams-api](https://github.com/fossteams/teams-api), [its Electron token helper](https://github.com/fossteams/teams-token), [consumer Teams Python client](https://github.com/roshank8s/teams-api). These are experimental projects, not Microsoft-supported APIs.

Local lint (including extension JavaScript), typecheck, build, all 15 tests, skill validation and dependency audit passed. Tests exercise the collector in a controlled JavaScript environment, import through the actual built CLI, encrypted storage, query matching, integrity/size/schema boundaries, and MCP JSON chunk reads with Microsoft disconnected. A separate native-browser DOM fixture verified that the collector retained the displayed homework text while excluding password input values, hidden text and script text, and removed a query token from the source URL. That fixture did not contain real school data.

Browser extension installation, Chrome scripting injection and real Teams assignment/reply capture remain unverified. The shared browser's /error/eoa result and failing snapshots prevented live feature exploration; read-only JavaScript evaluation did work and confirmed the error-page title. No cause is inferred from that error alone.

Deployment remains the local built stdio MCP process, plus an unpacked extension loaded by the student. No public service, database, Git remote, PR or remote CI is configured. Changes are isolated on feat/teams-manual-capture with recovery commit 1152aa5.
