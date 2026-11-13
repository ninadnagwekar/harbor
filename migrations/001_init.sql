-- Harbor schema. Safe to run more than once.

CREATE TABLE IF NOT EXISTS users (
	id UUID NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	title VARCHAR(80) DEFAULT '' NOT NULL, 
	password_hash VARCHAR(255) NOT NULL, 
	role VARCHAR(20) NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	last_login_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_users_role CHECK (role IN ('admin', 'member')), 
	CONSTRAINT ck_users_status CHECK (status IN ('active', 'deactivated'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email);

CREATE TABLE IF NOT EXISTS invitations (
	id UUID NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	name VARCHAR(120), 
	role VARCHAR(20) NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	invited_by UUID NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	accepted_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_invitations_role CHECK (role IN ('admin', 'member')), 
	FOREIGN KEY(invited_by) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS ix_invitations_email ON invitations (email);

CREATE UNIQUE INDEX IF NOT EXISTS ix_invitations_token_hash ON invitations (token_hash);

CREATE TABLE IF NOT EXISTS notifications (
	id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	kind VARCHAR(40) NOT NULL, 
	title VARCHAR(200) NOT NULL, 
	body TEXT NOT NULL, 
	link VARCHAR(300) NOT NULL, 
	dedupe_key VARCHAR(200), 
	read_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_notifications_user_id ON notifications (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_notifications_user_created ON notifications (user_id, created_at);

CREATE TABLE IF NOT EXISTS password_resets (
	id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	used_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_password_resets_user_id ON password_resets (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS ix_password_resets_token_hash ON password_resets (token_hash);

CREATE TABLE IF NOT EXISTS projects (
	id UUID NOT NULL, 
	name VARCHAR(140) NOT NULL, 
	description TEXT NOT NULL, 
	owner_id UUID NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	priority VARCHAR(20) NOT NULL, 
	start_date DATE, 
	target_date DATE, 
	tags TEXT[] DEFAULT '{}'::text[] NOT NULL, 
	archived_at TIMESTAMP WITH TIME ZONE, 
	deleted_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_projects_status CHECK (status IN ('not_started', 'planning', 'in_progress', 'on_hold', 'completed')), 
	CONSTRAINT ck_projects_priority CHECK (priority IN ('low', 'medium', 'high', 'critical')), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS ix_projects_status ON projects (status);

CREATE TABLE IF NOT EXISTS activity_logs (
	id UUID NOT NULL, 
	actor_id UUID, 
	project_id UUID, 
	task_id UUID, 
	action VARCHAR(60) NOT NULL, 
	summary TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(actor_id) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_activity_project_created ON activity_logs (project_id, created_at);

CREATE TABLE IF NOT EXISTS project_checklists (
	id UUID NOT NULL, 
	project_id UUID NOT NULL, 
	title VARCHAR(140) NOT NULL, 
	created_by UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
	FOREIGN KEY(created_by) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS ix_project_checklists_project_id ON project_checklists (project_id);

CREATE TABLE IF NOT EXISTS project_members (
	id UUID NOT NULL, 
	project_id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_project_member UNIQUE (project_id, user_id), 
	FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_project_members_project_id ON project_members (project_id);

CREATE INDEX IF NOT EXISTS ix_project_members_user_id ON project_members (user_id);

CREATE TABLE IF NOT EXISTS project_notes (
	id UUID NOT NULL, 
	project_id UUID NOT NULL, 
	author_id UUID NOT NULL, 
	title VARCHAR(160) NOT NULL, 
	body TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	deleted_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
	FOREIGN KEY(author_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS ix_project_notes_project_id ON project_notes (project_id);

CREATE TABLE IF NOT EXISTS tasks (
	id UUID NOT NULL, 
	project_id UUID NOT NULL, 
	title VARCHAR(200) NOT NULL, 
	external_id VARCHAR(40), 
	description TEXT NOT NULL, 
	task_type VARCHAR(20) NOT NULL, 
	assignee_id UUID, 
	creator_id UUID NOT NULL, 
	priority VARCHAR(20) NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	start_date DATE, 
	due_date DATE, 
	estimate_hours DOUBLE PRECISION, 
	tags TEXT[] DEFAULT '{}'::text[] NOT NULL, 
	steps_to_reproduce TEXT NOT NULL, 
	expected_result TEXT NOT NULL, 
	actual_result TEXT NOT NULL, 
	severity VARCHAR(20), 
	resolution_notes TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	deleted_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_tasks_status CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done')), 
	CONSTRAINT ck_tasks_priority CHECK (priority IN ('low', 'medium', 'high', 'critical')), 
	CONSTRAINT ck_tasks_type CHECK (task_type IN ('task', 'bug', 'feature', 'improvement')), 
	FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE, 
	FOREIGN KEY(assignee_id) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(creator_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS ix_tasks_due ON tasks (due_date);

CREATE INDEX IF NOT EXISTS ix_tasks_project_status ON tasks (project_id, status);

CREATE INDEX IF NOT EXISTS ix_tasks_project_id ON tasks (project_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_external_id ON tasks (external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_tasks_assignee ON tasks (assignee_id);

CREATE TABLE IF NOT EXISTS checklist_items (
	id UUID NOT NULL, 
	checklist_id UUID NOT NULL, 
	title VARCHAR(240) NOT NULL, 
	is_done BOOLEAN DEFAULT false NOT NULL, 
	completed_by UUID, 
	completed_at TIMESTAMP WITH TIME ZONE, 
	position INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(checklist_id) REFERENCES project_checklists (id) ON DELETE CASCADE, 
	FOREIGN KEY(completed_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_checklist_items_checklist_id ON checklist_items (checklist_id);

CREATE TABLE IF NOT EXISTS task_attachments (
	id UUID NOT NULL, 
	task_id UUID NOT NULL, 
	uploaded_by UUID NOT NULL, 
	filename VARCHAR(180) NOT NULL, 
	content_type VARCHAR(120) NOT NULL, 
	size INTEGER NOT NULL, 
	data BYTEA NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(task_id) REFERENCES tasks (id) ON DELETE CASCADE, 
	FOREIGN KEY(uploaded_by) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS ix_task_attachments_task_id ON task_attachments (task_id);

CREATE TABLE IF NOT EXISTS task_comments (
	id UUID NOT NULL, 
	task_id UUID NOT NULL, 
	author_id UUID NOT NULL, 
	body TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(task_id) REFERENCES tasks (id) ON DELETE CASCADE, 
	FOREIGN KEY(author_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS ix_task_comments_task_id ON task_comments (task_id);
