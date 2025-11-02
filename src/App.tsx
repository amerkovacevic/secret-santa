import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  Timestamp,
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';

type MemberProfile = {
  displayName: string;
  photoURL?: string | null;
};

type Assignment = {
  recipientId: string;
  recipientName: string;
  recipientPhotoURL?: string | null;
};

type CustomField = {
  id: string;
  label: string;
  placeholder?: string;
};

type MemberResponse = {
  [fieldId: string]: string;
};

type Group = {
  id: string;
  name: string;
  description?: string | null;
  ownerId: string;
  ownerName: string;
  ownerPhotoURL?: string | null;
  memberIds: string[];
  members: Record<string, MemberProfile>;
  assignments?: Record<string, Assignment> | null;
  customFields?: CustomField[];
  memberResponses?: Record<string, MemberResponse>;
  createdAt?: Timestamp | null;
  drawRunAt?: Timestamp | null;
};

const getDisplayName = (user: User) =>
  user.displayName || user.email || user.phoneNumber || 'Anonymous gifter';

const formatTimestamp = (timestamp?: Timestamp | null) => {
  if (!timestamp) {
    return null;
  }

  try {
    return timestamp.toDate().toLocaleString();
  } catch (error) {
    console.error('Failed to format timestamp', error);
    return null;
  }
};

const shuffle = <T,>(items: T[]) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const generateFieldId = () => `field_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);

  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState('');
  const [joinGroupFields, setJoinGroupFields] = useState<CustomField[]>([]);
  const [joinResponses, setJoinResponses] = useState<Record<string, string>>({});
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);

  const [isRunningDraw, setIsRunningDraw] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [drawSuccess, setDrawSuccess] = useState<string | null>(null);

  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setInitializing(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      setGroups([]);
      setSelectedGroupId(null);
      return () => undefined;
    }

    const groupsQuery = query(
      collection(db, 'groups'),
      where('memberIds', 'array-contains', user.uid),
    );

    const unsubscribe = onSnapshot(
      groupsQuery,
      (snapshot) => {
        const nextGroups: Group[] = snapshot.docs
          .map((docSnapshot) => {
            const data = docSnapshot.data();
            const members = (data.members ?? {}) as Record<string, MemberProfile>;
            const assignments = (data.assignments ?? null) as Group['assignments'];

            return {
              id: docSnapshot.id,
              name: data.name ?? 'Untitled group',
              description: data.description ?? null,
              ownerId: data.ownerId ?? '',
              ownerName: data.ownerName ?? 'Unknown organizer',
              ownerPhotoURL: data.ownerPhotoURL ?? null,
              memberIds: data.memberIds ?? [],
              members,
              assignments,
              customFields: (data.customFields ?? []) as CustomField[],
              memberResponses: (data.memberResponses ?? {}) as Record<string, MemberResponse>,
              createdAt: (data.createdAt as Timestamp | undefined) ?? null,
              drawRunAt: (data.drawRunAt as Timestamp | undefined) ?? null,
            } satisfies Group;
          })
          .sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() ?? 0;
            const bTime = b.createdAt?.toMillis?.() ?? 0;
            return bTime - aTime;
          });

        setGroupsError(null);
        setGroups(nextGroups);
      },
      (error) => {
        console.error('Failed to load groups', error);
        setGroupsError('Unable to load your groups right now.');
      },
    );

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (selectedGroupId && groups.some((group) => group.id === selectedGroupId)) {
      return;
    }

    setSelectedGroupId(groups[0]?.id ?? null);
  }, [groups, selectedGroupId]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  useEffect(() => {
    setDrawError(null);
    setDrawSuccess(null);
    setDeleteError(null);
  }, [selectedGroupId]);

  // Load custom fields when join code changes
  useEffect(() => {
    const loadGroupFields = async () => {
      const trimmedCode = joinCode.trim();
      if (!trimmedCode || trimmedCode.length < 20) {
        setJoinGroupFields([]);
        setJoinResponses({});
        return;
      }

      try {
        const groupRef = doc(db, 'groups', trimmedCode);
        const groupSnapshot = await getDoc(groupRef);
        if (groupSnapshot.exists()) {
          const data = groupSnapshot.data();
          const fields: CustomField[] = data.customFields ?? [];
          setJoinGroupFields(fields);
          // Initialize responses with empty strings
          const initialResponses: Record<string, string> = {};
          fields.forEach((field) => {
            initialResponses[field.id] = '';
          });
          setJoinResponses(initialResponses);
        } else {
          setJoinGroupFields([]);
          setJoinResponses({});
        }
      } catch (error) {
        console.error('Failed to load group fields', error);
        setJoinGroupFields([]);
        setJoinResponses({});
      }
    };

    loadGroupFields();
  }, [joinCode]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Failed to sign in', error);
      setAuthError('We could not start Google sign-in. Please try again.');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Failed to sign out', error);
    }
  };

  const handleCreateGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      return;
    }

    setCreateError(null);
    setCreateSuccess(null);
    setIsCreatingGroup(true);

    const trimmedName = newGroupName.trim();
    if (!trimmedName) {
      setCreateError('Give your group a name first.');
      setIsCreatingGroup(false);
      return;
    }

    try {
      const docRef = await addDoc(collection(db, 'groups'), {
        name: trimmedName,
        description: newGroupDescription.trim() || '',
        ownerId: user.uid,
        ownerName: getDisplayName(user),
        ownerPhotoURL: user.photoURL ?? null,
        memberIds: [user.uid],
        members: {
          [user.uid]: {
            displayName: getDisplayName(user),
            photoURL: user.photoURL ?? null,
          },
        },
        assignments: null,
        customFields: customFields.length > 0 ? customFields : undefined,
        memberResponses: {},
        createdAt: serverTimestamp(),
        drawRunAt: null,
      });

      setNewGroupName('');
      setNewGroupDescription('');
      setCustomFields([]);
      setCreateSuccess('Group created! Share the join code with your Santas.');
      setSelectedGroupId(docRef.id);
    } catch (error) {
      console.error('Failed to create group', error);
      setCreateError('Unable to create that group. Please try again.');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleJoinGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      return;
    }

    const trimmedCode = joinCode.trim();
    if (!trimmedCode) {
      setJoinError('Enter a join code.');
      setJoinSuccess(null);
      return;
    }

    setJoinError(null);
    setJoinSuccess(null);
    setIsJoining(true);

    try {
      const groupRef = doc(db, 'groups', trimmedCode);
      const groupSnapshot = await getDoc(groupRef);

      if (!groupSnapshot.exists()) {
        setJoinError('No group found with that code.');
        setIsJoining(false);
        return;
      }

      const data = groupSnapshot.data();
      const memberIds: string[] = data.memberIds ?? [];
      if (memberIds.includes(user.uid)) {
        setJoinError('You are already part of that group.');
        setIsJoining(false);
        return;
      }

      const memberField = `members.${user.uid}`;
      const customFields: CustomField[] = data.customFields ?? [];
      
      // Validate that all custom fields have responses
      if (customFields.length > 0) {
        const missingFields = customFields.filter(
          (field) => !joinResponses[field.id] || !joinResponses[field.id].trim()
        );
        if (missingFields.length > 0) {
          setJoinError(`Please fill out all required fields: ${missingFields.map(f => f.label).join(', ')}`);
          setIsJoining(false);
          return;
        }
      }

      const responseField = `memberResponses.${user.uid}`;
      await updateDoc(groupRef, {
        memberIds: arrayUnion(user.uid),
        [memberField]: {
          displayName: getDisplayName(user),
          photoURL: user.photoURL ?? null,
        },
        [responseField]: joinResponses,
      });

      setJoinSuccess('Welcome aboard! You have joined the group.');
      setJoinCode('');
      setJoinGroupFields([]);
      setJoinResponses({});
      setSelectedGroupId(trimmedCode);
    } catch (error) {
      console.error('Failed to join group', error);
      setJoinError('Could not join that group. Please double-check the code.');
    } finally {
      setIsJoining(false);
    }
  };

  const handleRunDraw = async (group: Group) => {
    if (!user || user.uid !== group.ownerId) {
      return;
    }

    setDrawError(null);
    setDrawSuccess(null);

    if (group.memberIds.length < 2) {
      setDrawError('You need at least two members to run a draw.');
      return;
    }

    setIsRunningDraw(true);

    try {
      const shuffledMembers = shuffle(group.memberIds);
      const assignments: Record<string, Assignment> = {};

      for (let index = 0; index < shuffledMembers.length; index += 1) {
        const giverId = shuffledMembers[index];
        const receiverId = shuffledMembers[(index + 1) % shuffledMembers.length];
        const receiverProfile = group.members[receiverId];

        assignments[giverId] = {
          recipientId: receiverId,
          recipientName: receiverProfile?.displayName ?? 'Mystery Santa',
          recipientPhotoURL: receiverProfile?.photoURL ?? null,
        };
      }

      await updateDoc(doc(db, 'groups', group.id), {
        assignments,
        drawRunAt: serverTimestamp(),
      });

      setDrawSuccess('Draw completed! Everyone now has someone to surprise.');
    } catch (error) {
      console.error('Failed to run draw', error);
      setDrawError('Something went wrong running the draw. Please try again.');
    } finally {
      setIsRunningDraw(false);
    }
  };

  const handleDeleteGroup = async (group: Group) => {
    if (!user || user.uid !== group.ownerId) {
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete "${group.name}"? This action cannot be undone and will remove the group for all members.`
    );

    if (!confirmed) {
      return;
    }

    setDeleteError(null);
    setIsDeletingGroup(true);

    try {
      await deleteDoc(doc(db, 'groups', group.id));
      // Group will be automatically removed from groups list via onSnapshot
      setSelectedGroupId(null);
    } catch (error) {
      console.error('Failed to delete group', error);
      setDeleteError('Unable to delete the group. Please try again.');
      setIsDeletingGroup(false);
    }
  };

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-700 border-t-emerald-400" />
          <p className="text-sm text-slate-400">Loading your workshop…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4">
        <div className="w-full max-w-lg space-y-8 rounded-3xl border border-slate-800/80 bg-slate-900/80 p-10 text-center shadow-2xl shadow-emerald-500/10 backdrop-blur">
          <div className="space-y-3">
            <p className="text-sm uppercase tracking-[0.35em] text-emerald-400">Secret Santa</p>
            <h1 className="text-4xl font-semibold text-white sm:text-5xl">Gift Exchange HQ</h1>
            <p className="text-base text-slate-400">
              Orchestrate festive fun with Google sign-in, smart group management, and effortless draws powered by Firebase.
            </p>
          </div>
          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="inline-flex w-full items-center justify-center gap-3 rounded-full bg-emerald-400/90 px-6 py-3 text-lg font-semibold text-slate-950 transition hover:bg-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            <span>Continue with Google</span>
            <svg className="h-6 w-6" viewBox="0 0 533.5 544.3" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M533.5 278.4c0-18.5-1.5-37.1-4.7-55.3H272v104.8h146.9c-6.3 34-25 62.8-53.6 82.1v68.2h86.4c50.7-46.7 81.8-115.5 81.8-199.8z"
              />
              <path
                fill="#34A853"
                d="M272 544.3c72.6 0 133.6-23.9 178.1-64.1l-86.4-68.2c-24 16.2-54.7 25.6-91.7 25.6-70.5 0-130.3-47.6-151.7-111.5H29v69.9C73.8 488.9 165.7 544.3 272 544.3z"
              />
              <path
                fill="#FBBC05"
                d="M120.3 325.9c-10.4-31.1-10.4-64.8 0-95.9V160h-91.3C10.3 204.4 0 247.6 0 292.2s10.3 87.8 29 132.2l91.3-69.9z"
              />
              <path
                fill="#EA4335"
                d="M272 107.7c39.4-.6 77.4 14 106.2 40.9l79.2-79.2C405.8 24 345.7 0 272 0 165.7 0 73.8 55.4 29 139.9l91.3 69.9C141.7 155.3 201.5 107.7 272 107.7z"
              />
            </svg>
          </button>
          {authError ? <p className="text-sm text-rose-400">{authError}</p> : null}
        </div>
      </div>
    );
  }

  const memberProfiles = selectedGroup
    ? Object.entries(selectedGroup.members ?? {}).map(([id, profile]) => ({
        id,
        displayName: profile.displayName,
        photoURL: profile.photoURL ?? null,
      }))
    : [];

  memberProfiles.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const myAssignment = selectedGroup?.assignments?.[user.uid] ?? null;
  const drawRanAt = formatTimestamp(selectedGroup?.drawRunAt);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pb-16 text-slate-100">
      <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-emerald-400">Secret Santa</p>
            <h1 className="text-2xl font-semibold text-white sm:text-3xl">Gift Exchange HQ</h1>
          </div>
          <div className="flex items-center gap-3">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={getDisplayName(user)}
                className="h-10 w-10 rounded-full border border-emerald-400/60"
                referrerPolicy="no-referrer"
              />
            ) : null}
            <div className="text-right">
              <p className="text-sm font-medium text-white">{getDisplayName(user)}</p>
              <button
                type="button"
                onClick={handleSignOut}
                className="text-xs text-slate-400 underline-offset-2 transition hover:text-emerald-300 hover:underline"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pt-10">
        {groupsError ? (
          <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {groupsError}
          </p>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-6 shadow-lg shadow-emerald-500/5">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-xl font-semibold text-white">Your groups</h2>
                <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                  {groups.length} active
                </span>
              </div>
              {groups.length === 0 ? (
                <p className="mt-4 text-sm text-slate-400">
                  You are not part of any groups yet. Create one or join with a code to get started.
                </p>
              ) : (
                <div className="mt-6 space-y-2">
                  {groups.map((group) => (
                    <button
                      type="button"
                      key={group.id}
                      onClick={() => setSelectedGroupId(group.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                        selectedGroupId === group.id
                          ? 'border-emerald-400/60 bg-emerald-400/10 text-white'
                          : 'border-slate-800/80 bg-slate-900/60 text-slate-300 hover:border-emerald-400/40 hover:bg-slate-900/80 hover:text-white'
                      }`}
                    >
                      <div>
                        <p className="text-sm font-semibold sm:text-base">{group.name}</p>
                        <p className="text-xs text-slate-400">{group.memberIds.length} members</p>
                      </div>
                      {group.ownerId === user.uid ? (
                        <span className="rounded-full bg-emerald-400/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                          Organizer
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-slate-800/80 bg-slate-900/80 p-6 shadow-lg shadow-emerald-500/5">
              {selectedGroup ? (
                <div className="space-y-6">
                  <header>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-2xl font-semibold text-white">{selectedGroup.name}</h2>
                      <span className="rounded-full border border-emerald-400/50 px-3 py-1 text-xs font-semibold text-emerald-300">
                        Code: {selectedGroup.id}
                      </span>
                    </div>
                    {selectedGroup.description ? (
                      <p className="mt-2 text-sm text-slate-400">{selectedGroup.description}</p>
                    ) : null}
                    <p className="mt-3 text-xs text-slate-500">
                      Host: {selectedGroup.ownerName}
                    </p>
                    {drawRanAt ? (
                      <p className="mt-1 text-xs text-emerald-300/80">
                        Last draw: {drawRanAt}
                      </p>
                    ) : null}
                  </header>

                  {drawError ? (
                    <p className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                      {drawError}
                    </p>
                  ) : null}
                  {drawSuccess ? (
                    <p className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                      {drawSuccess}
                    </p>
                  ) : null}

                  {myAssignment ? (
                    <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5">
                      <p className="text-sm uppercase tracking-wide text-emerald-300">Your match</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{myAssignment.recipientName}</p>
                      {selectedGroup.customFields && selectedGroup.customFields.length > 0 && selectedGroup.memberResponses?.[myAssignment.recipientId] && (
                        <div className="mt-4 space-y-2">
                          {selectedGroup.customFields.map((field) => {
                            const response = selectedGroup.memberResponses?.[myAssignment.recipientId]?.[field.id];
                            if (!response) return null;
                            return (
                              <div key={field.id} className="text-sm">
                                <span className="text-emerald-200/80">{field.label}:</span>{' '}
                                <span className="text-white font-medium">{response}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <p className="mt-3 text-sm text-emerald-200/80">
                        Keep it secret! Only you can see this assignment.
                      </p>
                    </div>
                  ) : (
                    <p className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5 text-sm text-slate-400">
                      Waiting for the organizer to run the draw. Once they do, your match will appear here.
                    </p>
                  )}

                  <div>
                    <h3 className="text-lg font-semibold text-white">Group roster</h3>
                    <ul className="mt-3 space-y-2">
                      {memberProfiles.map((member) => (
                        <li
                          key={member.id}
                          className="flex items-center gap-3 rounded-2xl border border-slate-800/70 bg-slate-900/70 px-4 py-3"
                        >
                          {member.photoURL ? (
                            <img
                              src={member.photoURL}
                              alt={member.displayName}
                              className="h-9 w-9 rounded-full border border-slate-700"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-300">
                              {member.displayName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="flex flex-1 items-center justify-between gap-3">
                            <div className="flex-1">
                              <p className="text-sm font-medium text-white">{member.displayName}</p>
                              <p className="text-[10px] uppercase tracking-wide text-slate-500">
                                {member.id === selectedGroup.ownerId ? 'Organizer' : 'Participant'}
                              </p>
                              {selectedGroup.customFields && selectedGroup.customFields.length > 0 && selectedGroup.memberResponses?.[member.id] && (
                                <div className="mt-2 space-y-1">
                                  {selectedGroup.customFields.map((field) => {
                                    const response = selectedGroup.memberResponses?.[member.id]?.[field.id];
                                    if (!response) return null;
                                    return (
                                      <div key={field.id} className="text-xs text-slate-400">
                                        <span className="font-medium">{field.label}:</span> {response}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            {selectedGroup.assignments?.[member.id]?.recipientName ? (
                              <span className="rounded-full bg-slate-800/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                Assigned
                              </span>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {user.uid === selectedGroup.ownerId ? (
                    <>
                      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
                        <h3 className="text-lg font-semibold text-white">Ready to draw?</h3>
                        <p className="mt-1 text-sm text-emerald-100/80">
                          Only you can run the draw. Everyone will immediately see who they are gifting once you launch it.
                        </p>
                        <button
                          type="button"
                          onClick={() => handleRunDraw(selectedGroup)}
                          disabled={isRunningDraw}
                          className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-400/90 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isRunningDraw ? 'Drawing names…' : 'Run the draw'}
                        </button>
                      </div>

                      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5">
                        <h3 className="text-lg font-semibold text-white">Danger zone</h3>
                        <p className="mt-1 text-sm text-rose-100/80">
                          Permanently delete this group. This action cannot be undone.
                        </p>
                        {deleteError ? (
                          <p className="mt-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                            {deleteError}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleDeleteGroup(selectedGroup)}
                          disabled={isDeletingGroup}
                          className="mt-4 inline-flex items-center gap-2 rounded-full bg-rose-500/90 px-6 py-3 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isDeletingGroup ? 'Deleting…' : 'Delete group'}
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-400">
                  Select a group to view its members and draw details.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <form
              onSubmit={handleCreateGroup}
              className="space-y-5 rounded-3xl border border-slate-800/80 bg-slate-900/80 p-6 shadow-lg shadow-emerald-500/5"
            >
              <div>
                <h2 className="text-xl font-semibold text-white">Create a group</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Spin up a brand-new exchange and invite friends with the join code.
                </p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Group name
                    <input
                      type="text"
                      value={newGroupName}
                      onChange={(event) => setNewGroupName(event.target.value)}
                      placeholder="E.g. Product Team Elves"
                      className="mt-1 w-full rounded-2xl border border-slate-700/80 bg-slate-900 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    />
                  </label>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Description (optional)
                    <textarea
                      value={newGroupDescription}
                      onChange={(event) => setNewGroupDescription(event.target.value)}
                      placeholder="Let everyone know the theme, budget, or gift ideas."
                      rows={3}
                      className="mt-1 w-full rounded-2xl border border-slate-700/80 bg-slate-900 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    />
                  </label>
                </div>
              </div>
              
              {/* Custom Fields Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Custom fields (optional)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomFields([...customFields, { id: generateFieldId(), label: '', placeholder: '' }]);
                    }}
                    className="text-xs text-emerald-400 hover:text-emerald-300 transition"
                  >
                    + Add field
                  </button>
                </div>
                {customFields.map((field, index) => (
                  <div key={field.id} className="flex gap-2 items-start">
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        value={field.label}
                        onChange={(event) => {
                          const updated = [...customFields];
                          updated[index] = { ...field, label: event.target.value };
                          setCustomFields(updated);
                        }}
                        placeholder="Field label (e.g., Jersey size, Avoidable clubs)"
                        className="w-full rounded-xl border border-slate-700/80 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                      />
                      <input
                        type="text"
                        value={field.placeholder || ''}
                        onChange={(event) => {
                          const updated = [...customFields];
                          updated[index] = { ...field, placeholder: event.target.value };
                          setCustomFields(updated);
                        }}
                        placeholder="Placeholder text (optional)"
                        className="w-full rounded-xl border border-slate-700/80 bg-slate-900 px-3 py-2 text-xs text-slate-300 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomFields(customFields.filter((_, i) => i !== index));
                      }}
                      className="px-3 py-2 text-xs text-slate-400 hover:text-rose-400 transition"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {customFields.length > 0 && (
                  <p className="text-xs text-slate-500">
                    Members will be asked to fill out these fields when joining the group.
                  </p>
                )}
              </div>
              
              {createError ? (
                <p className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {createError}
                </p>
              ) : null}
              {createSuccess ? (
                <p className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  {createSuccess}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={isCreatingGroup}
                className="inline-flex w-full items-center justify-center rounded-full bg-emerald-400/90 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCreatingGroup ? 'Creating…' : 'Create group'}
              </button>
            </form>

            <form
              onSubmit={handleJoinGroup}
              className="space-y-5 rounded-3xl border border-slate-800/80 bg-slate-900/80 p-6 shadow-lg shadow-emerald-500/5"
            >
              <div>
                <h2 className="text-xl font-semibold text-white">Join a group</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Enter the join code shared by your organizer to hop into the fun.
                </p>
              </div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Join code
                <input
                  type="text"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  placeholder="Paste the code here"
                  className="mt-1 w-full rounded-2xl border border-slate-700/80 bg-slate-900 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                />
              </label>
              
              {/* Custom Fields for Joining */}
              {joinGroupFields.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Please fill out the following:
                  </p>
                  {joinGroupFields.map((field) => (
                    <label key={field.id} className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {field.label}
                      <input
                        type="text"
                        value={joinResponses[field.id] || ''}
                        onChange={(event) => {
                          setJoinResponses({ ...joinResponses, [field.id]: event.target.value });
                        }}
                        placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                        className="mt-1 w-full rounded-2xl border border-slate-700/80 bg-slate-900 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                      />
                    </label>
                  ))}
                </div>
              )}
              
              {joinError ? (
                <p className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {joinError}
                </p>
              ) : null}
              {joinSuccess ? (
                <p className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  {joinSuccess}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={isJoining}
                className="inline-flex w-full items-center justify-center rounded-full bg-slate-800 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isJoining ? 'Joining…' : 'Join group'}
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
