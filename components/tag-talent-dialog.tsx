'use client';

import { Loader2, User, X } from 'lucide-react';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  searchTalentUsers,
  tagPhotosForTalentAction,
} from '@/app/[lang]/dashboard/photographer/events/[id]/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDebounce } from '@/hooks/use-debounce';

interface TagTalentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photoIds: string[];
  onSuccess?: () => void;
}

export function TagTalentDialog({ open, onOpenChange, photoIds, onSuccess }: TagTalentDialogProps) {
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<
    Array<{
      id: string;
      username: string;
      display_name: string | null;
    }>
  >([]);
  const [selectedTalents, setSelectedTalents] = useState<
    Array<{
      id: string;
      username: string;
      display_name: string | null;
    }>
  >([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isTagging, startTagging] = useTransition();
  const [showResults, setShowResults] = useState(false);

  const debouncedSearch = useDebounce(searchText, 300);

  useEffect(() => {
    const performSearch = async () => {
      if (!debouncedSearch.trim() || debouncedSearch.length < 2) {
        setSearchResults([]);
        setShowResults(false);
        return;
      }

      setIsSearching(true);
      try {
        const results = await searchTalentUsers(debouncedSearch, 10);
        // Filter out already selected talents from results
        const filteredResults = results.filter(
          (result) => !selectedTalents.some((selected) => selected.id === result.id),
        );
        setSearchResults(filteredResults);
        setShowResults(true);
      } catch (error) {
        console.error('Error searching for talent:', error);
        toast.error(
          error instanceof Error ? `Search failed: ${error.message}` : 'Failed to search for users',
        );
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    void performSearch();
  }, [debouncedSearch, selectedTalents]);

  const handleSelectTalent = useCallback(
    (talent: { id: string; username: string; display_name: string | null }) => {
      // Check if already selected
      if (selectedTalents.some((t) => t.id === talent.id)) {
        return;
      }
      setSelectedTalents((prev) => [...prev, talent]);
      setSearchText('');
      setSearchResults([]);
      setShowResults(false);
      // Blur the input to close any open dropdowns
      const input = document.getElementById('search');
      if (input instanceof HTMLInputElement) {
        input.blur();
      }
    },
    [selectedTalents],
  );

  const handleRemoveTalent = useCallback((talentId: string) => {
    setSelectedTalents((prev) => prev.filter((t) => t.id !== talentId));
  }, []);

  const handleTag = () => {
    if (selectedTalents.length === 0) return;

    startTagging(async () => {
      try {
        // Tag all selected talents
        const results = await Promise.all(
          selectedTalents.map((talent) => tagPhotosForTalentAction(photoIds, talent.id)),
        );

        const successCount = results.filter((r) => r.success).length;
        const totalTagged = results.reduce((sum, r) => sum + r.taggedCount, 0);

        if (successCount > 0) {
          toast.success(
            `Tagged ${totalTagged} photo${totalTagged !== 1 ? 's' : ''} for ${successCount} talent${successCount !== 1 ? 's' : ''}`,
          );
          onOpenChange(false);
          setSearchText('');
          setSelectedTalents([]);
          setSearchResults([]);
          onSuccess?.();
        } else {
          toast.error('Failed to tag photos');
        }
      } catch (error) {
        console.error('Error tagging photos:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to tag photos');
      }
    });
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSearchText('');
      setSelectedTalents([]);
      setSearchResults([]);
      setShowResults(false);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tag Talent</DialogTitle>
          <DialogDescription>
            Search for a talent user by username to tag {photoIds.length}{' '}
            {photoIds.length === 1 ? 'photo' : 'photos'}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="search">Search by username or name</Label>
            <div className="relative">
              <Input
                id="search"
                type="text"
                placeholder="Type to search..."
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  if (e.target.value.length >= 2) {
                    setShowResults(true);
                  } else {
                    setShowResults(false);
                  }
                }}
                onFocus={() => {
                  if (searchResults.length > 0) {
                    setShowResults(true);
                  }
                }}
                disabled={isTagging}
                autoComplete="off"
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {showResults && searchResults.length > 0 && searchText.length >= 2 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
                  <div className="max-h-60 overflow-auto p-1">
                    {searchResults.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                        onClick={() => handleSelectTalent(user)}
                      >
                        <div className="font-medium">{user.display_name || 'No name'}</div>
                        <div className="text-xs text-muted-foreground">@{user.username}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {selectedTalents.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">
                Selected ({selectedTalents.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedTalents.map((talent) => (
                  <div
                    key={talent.id}
                    className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 flex-1"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {talent.display_name || 'No name'}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        @{talent.username}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => handleRemoveTalent(talent.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isTagging}>
            Cancel
          </Button>
          <Button
            onClick={handleTag}
            disabled={selectedTalents.length === 0 || isTagging || photoIds.length === 0}
          >
            {isTagging ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Tagging...
              </>
            ) : (
              `Tag ${photoIds.length} photo${photoIds.length !== 1 ? 's' : ''}${selectedTalents.length > 0 ? ` for ${selectedTalents.length} talent${selectedTalents.length !== 1 ? 's' : ''}` : ''}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
