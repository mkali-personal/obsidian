I wish to make a notification system for tags in Obsidian, for shared folders, which will be added to per-machine-workspace. As I see it, there could be two possible implementations, that I want you to help me rank.

# Implementation 1:

- The plugin allows the user to follow tags of their interest. All followed tags are of the form #notify/some-name . For example: `#notify/mkali`.
- The plugin saves those tags after which he follows in the .obsidian\plugins\per-machine-workspace\data.json file as a list under their hostname. The plugin also saves a "Last seen" timestamp, which will come into play in a couple of bullets.
- The plugin also saves a timestamp of the last mark-as-read pressing. When a tag of the form notify/some-name is added, the plugin add any kind of a timestamp to it, ideally in a way that is not visible to the user. The timestamp should not be save in an external data file, as if the file is edited, the filename+row number reference will quickly break.
- The plugin has an Icon at the sidebar of Obsidian. when clicked, panel next to the sidebar is filled with all of the tags after which they follow, and that have a timesamp which is later then the "Last seen" timestamp of the user.
- The plugin has a button/command to set the user's "Last seen" timestamp to present, thus "archiving" all of his "unread" tags.

# Implementation 2:
- The plugin has a Comment environment, which can be added to a markdown file, similarly to a Callout of obsidian.
- In the plugin configuration, the user can  define his own name, which will be saved as belong to his machine.
- The plugin saves those tags after which he follows in the .obsidian\plugins\per-machine-workspace\data.json file as a list under their hostname. The plugin also saves a "Last seen" timestamp, which will come into play in a couple of bullets.
- The comment environment has some gentle yellow background, so it is visibly a separate environment.
- This environment has four attributes:
	- tagged users, which are always of the form #notify/some-name 
	- creator, which is the user which belongs to the creating machine
	- timestamp, which is the timestamp of creation
	- and the content of the comment.
- When a comment is created, the plugin writes by itself the creator and the timestamp in their relevant slots, and in the tagged user position it writes #notify/ . The creator of the comment needs to complete the tag to choose the specific user they want to notify.
- The plugin has an Icon at the sidebar of Obsidian. when clicked, panel next to the sidebar is filled with all of the comments in the repository after which they follow, and that have a timestamp which is later then the "Last seen" timestamp of the user.
- The plugin has a button/command to set the user's "Last seen" timestamp to present, thus "archiving" all of his "unread" tags.

A similar example of such comments environment plugin can be seen under C:\Users\michaeka\Weizmann Institute Dropbox\Michael Kali\Obsidian\.obsidian\plugins\comments. This plugin, however is only an environment for the comment, without the notification system.

Please help me choose the better option of the two, and specifically which is more feasible.