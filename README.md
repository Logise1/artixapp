# SchoolConnect

A Slack-like classroom application for Professors and Students.

## How to Run

Because this application uses JavaScript Modules for Firebase, **you must run it using a local web server**. It will not work if you just double-click `login.html`.

### Option 1: VS Code Live Server
1. Right-click `login.html` in VS Code.
2. Select "Open with Live Server".

### Option 2: Node via Terminal
Run the following command in the terminal to start a simple server:

```bash
npx serve .
```

Then open the URL shown (usually `http://localhost:3000`).

## Features

- **Authentication**: Sign up as a Student or Professor.
- **Professors**: Create classes, add students by email, create channels (Chat or Task type), create assignments.
- **Students**: View classes, chat in channels, submit assignments (links/files).
- **Real-time**: Built on Firebase Firestore for live updates.
