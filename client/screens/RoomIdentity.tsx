import { useState } from 'react';
import { Avatar } from '../components/Avatar';
import { AVATAR_COUNT } from '../../shared/room';

interface RoomIdentityProps {
  code: string;
  avatar: number;
  onConfirm: (name: string, avatar: number) => void;
  onLeave: () => void;
}

/** First visit through a shared room link, before the socket takes a seat. */
export function RoomIdentity({ code, avatar, onConfirm, onLeave }: RoomIdentityProps) {
  const [name, setName] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(avatar);

  return (
    <main className="table-felt flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-md space-y-6">
        <header className="text-center">
          <p className="text-xs font-semibold tracking-widest text-chalk-faint uppercase">Joining room</p>
          <h1 className="tabular mt-1 text-4xl tracking-[0.18em] text-chalk">{code}</h1>
          <p className="mt-3 text-sm text-chalk-dim">Choose how your friends will see you at the table.</p>
        </header>

        <form
          className="space-y-5 rounded-xl border border-edge bg-raised p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const chosenName = name.trim();
            if (chosenName) onConfirm(chosenName, selectedAvatar);
          }}
        >
          <div>
            <label htmlFor="room-name" className="mb-1.5 block text-sm font-semibold text-chalk">Your name</label>
            <input
              id="room-name"
              autoFocus
              required
              maxLength={16}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Pick a name"
              className="w-full rounded-xl border border-edge bg-felt px-4 py-3 text-base text-chalk placeholder:text-chalk-faint"
            />
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-chalk">Your avatar</legend>
            <div className="grid grid-cols-6 gap-2">
              {Array.from({ length: AVATAR_COUNT }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={`Avatar ${index + 1}`}
                  aria-pressed={selectedAvatar === index}
                  onClick={() => setSelectedAvatar(index)}
                  className={`flex justify-center rounded-lg p-1 ${selectedAvatar === index ? 'bg-chalk/15 ring-2 ring-chalk' : 'hover:bg-chalk/5'}`}
                >
                  <Avatar index={index} size={38} />
                </button>
              ))}
            </div>
          </fieldset>
          <button type="submit" className="display w-full rounded-xl bg-chalk px-5 py-4 text-lg text-felt transition hover:bg-white">
            Join room
          </button>
        </form>
        <button onClick={onLeave} className="mx-auto block rounded-lg border border-edge px-4 py-2 text-sm text-chalk-dim">
          Back
        </button>
      </div>
    </main>
  );
}
