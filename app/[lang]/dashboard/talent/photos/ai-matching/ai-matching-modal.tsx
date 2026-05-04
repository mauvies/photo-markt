'use client';

import { AlertCircle, Loader2, Sparkles, X } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { activityOptions } from '@/app/[lang]/dashboard/photographer/events/new/activity-options';
import { LocationSelector } from '@/components/location-selector';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isFeatureEnabled } from '@/lib/feature-flags';
import {
  type AISearchProfile,
  addMatchedPhotosToLibrary,
  checkAISearchAvailability,
  createMyAISearchProfile,
  getMyAISearchProfiles,
  getUserCountry,
  runAISimilaritySearch,
  type SimilarityMatch,
} from './actions';
import { AIMatchingResults } from './ai-matching-results';

type Step = 'upload' | 'filters' | 'preset' | 'searching' | 'results';

interface AIMatchingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AIMatchingModal({ open, onOpenChange }: AIMatchingModalProps) {
  // Check feature flag - close modal if disabled
  const isEnabled = isFeatureEnabled('AI_MATCHING');

  useEffect(() => {
    if (!isEnabled && open) {
      onOpenChange(false);
      toast.info('AI Matching is coming soon!');
    }
  }, [isEnabled, open, onOpenChange]);

  const [step, setStep] = useState<Step>('upload');
  const [isPending, startTransition] = useTransition();

  // Form state
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [activityType, setActivityType] = useState<string>('');
  const [country, setCountry] = useState<string>('');
  const [region, setRegion] = useState<string>('');
  const [eventDate, setEventDate] = useState<string>('');
  const [saveAsPreset, setSaveAsPreset] = useState(false);
  const [presetName, setPresetName] = useState<string>('');
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  // Data state
  const [presets, setPresets] = useState<AISearchProfile[]>([]);
  const [availability, setAvailability] = useState<{
    available: boolean;
    currentUsage: number;
    limit: number | null;
    description: string;
  } | null>(null);
  const [searchResults, setSearchResults] = useState<SimilarityMatch[]>([]);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());

  // Load presets and availability on mount
  useEffect(() => {
    if (open) {
      startTransition(async () => {
        try {
          const [presetsData, availabilityData] = await Promise.all([
            getMyAISearchProfiles(),
            checkAISearchAvailability(),
          ]);
          setPresets(presetsData);
          setAvailability(availabilityData);

          // Prefill country from user profile if available
          try {
            const userCountry = await getUserCountry();
            if (userCountry) {
              setCountry(userCountry);
            }
          } catch (error) {
            console.error('Failed to get user country:', error);
          }
        } catch (error) {
          console.error('Failed to load data:', error);
        }
      });
    }
  }, [open]);

  // Handle selfie file upload
  const handleSelfieUpload = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image size must be less than 10MB');
      return;
    }

    setSelfieFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setSelfiePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  // Handle preset selection
  const handlePresetSelect = useCallback(
    (presetId: string) => {
      const preset = presets.find((p) => p.id === presetId);
      if (!preset) return;

      setSelectedPresetId(presetId);
      setActivityType(preset.activity_type ?? '');
      setCountry(preset.country ?? '');
      setRegion(preset.region ?? '');
      // Don't set date from preset - user should select date each time
    },
    [presets],
  );

  // Handle search
  const handleSearch = useCallback(() => {
    if (!selfieFile && !selectedPresetId) {
      toast.error('Please upload a selfie or select a preset');
      return;
    }

    if (!availability?.available) {
      toast.error(
        `AI search limit exceeded. ${availability?.description}. Please upgrade your plan.`,
      );
      return;
    }

    setStep('searching');
    startTransition(async () => {
      try {
        // Create a placeholder file if using a preset (won't be used)
        const fileToUse = selfieFile ?? new File([], 'placeholder.jpg', { type: 'image/jpeg' });
        const results = await runAISimilaritySearch(
          fileToUse,
          {
            activity_type: activityType || undefined,
            country: country || undefined,
            region: region || undefined,
            date_from: eventDate || undefined,
            date_to: eventDate || undefined, // Use same date for both (single date filter)
            min_similarity: 0.5,
            limit: 50,
          },
          selectedPresetId ?? undefined,
        );

        setSearchResults(results.matches);
        setStep('results');

        // Update availability
        const newAvailability = await checkAISearchAvailability();
        setAvailability(newAvailability);

        // Save as preset if requested (without date)
        if (saveAsPreset && presetName) {
          try {
            await createMyAISearchProfile({
              name: presetName,
              selfieFile: selfieFile ?? undefined,
              activity_type: activityType || null,
              country: country || null,
              region: region || null,
              // Don't save date - presets don't include date
              date_from: null,
              date_to: null,
            });
            toast.success('Preset saved successfully');
            const updatedPresets = await getMyAISearchProfiles();
            setPresets(updatedPresets);
          } catch (error) {
            console.error('Failed to save preset:', error);
          }
        }
      } catch (error) {
        console.error('Search failed:', error);
        toast.error(
          error instanceof Error ? error.message : 'Failed to run AI search. Please try again.',
        );
        setStep('filters');
      }
    });
  }, [
    selfieFile,
    selectedPresetId,
    activityType,
    country,
    region,
    eventDate,
    saveAsPreset,
    presetName,
    availability,
  ]);

  // Handle add photos to library
  const handleAddToLibrary = useCallback(() => {
    if (selectedPhotoIds.size === 0) {
      toast.error('Please select at least one photo');
      return;
    }

    startTransition(async () => {
      try {
        const { added } = await addMatchedPhotosToLibrary(Array.from(selectedPhotoIds));
        toast.success(`Added ${added} photo${added === 1 ? '' : 's'} to your library`);
        onOpenChange(false);
        // Refresh the page to show new photos
        window.location.reload();
      } catch (error) {
        console.error('Failed to add photos:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to add photos to library');
      }
    });
  }, [selectedPhotoIds, onOpenChange]);

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setStep('upload');
      setSelfieFile(null);
      setSelfiePreview(null);
      setActivityType('');
      setCountry('');
      setRegion('');
      setEventDate('');
      setSaveAsPreset(false);
      setPresetName('');
      setSelectedPresetId(null);
      setSearchResults([]);
      setSelectedPhotoIds(new Set());
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Find My Photos
          </DialogTitle>
          <DialogDescription>
            Upload a selfie and let AI find photos of you from events
          </DialogDescription>
        </DialogHeader>

        {/* Availability warning */}
        {availability && !availability.available && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-destructive">Search limit exceeded</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {availability.description}. Please upgrade your plan for more searches.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Preset selection or Upload selfie */}
        {step === 'upload' && (
          <div className="space-y-4">
            {/* Preset selection at the top */}
            {presets.length > 0 && (
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <div>
                  <Label className="text-base font-semibold">Use a saved preset</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Quickly reuse your previous search settings
                  </p>
                </div>
                <Select
                  value={selectedPresetId ?? '__none__'}
                  onValueChange={(value) => {
                    if (value && value !== '__none__') {
                      handlePresetSelect(value);
                      // Auto-advance to filters if preset selected
                      setStep('filters');
                    } else {
                      setSelectedPresetId(null);
                    }
                  }}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select a preset to use..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None - Upload new selfie</SelectItem>
                    {presets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                        {preset.activity_type && ` • ${preset.activity_type}`}
                        {preset.country && ` • ${preset.country}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {presets.length > 0 && (
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    Or add a new profile manually
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <Label className="text-base font-semibold">Upload a selfie</Label>
                <p className="text-sm text-muted-foreground mt-1.5 mb-4">
                  For best results, use a clear photo with good lighting. Avoid photos with goggles,
                  helmets, or water sports gear that obscure your face.
                </p>
                {selfiePreview ? (
                  <div className="relative w-full max-w-md mx-auto rounded-lg overflow-hidden border-2 border-primary/20 shadow-lg">
                    <Image
                      src={selfiePreview}
                      alt="Selfie preview"
                      width={400}
                      height={400}
                      className="rounded-lg object-cover w-full h-auto"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute top-3 right-3 shadow-md"
                      onClick={() => {
                        setSelfieFile(null);
                        setSelfiePreview(null);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-muted-foreground/25 rounded-xl p-10 text-center transition-colors hover:border-primary/50 hover:bg-muted/50">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleSelfieUpload(file);
                        }
                      }}
                      className="hidden"
                      id="selfie-upload"
                    />
                    <label
                      htmlFor="selfie-upload"
                      className="cursor-pointer flex flex-col items-center gap-4"
                    >
                      <div className="rounded-full bg-primary/10 p-6 transition-transform hover:scale-105">
                        <Sparkles className="h-10 w-10 text-primary" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-base font-semibold">Click to upload a selfie</p>
                        <p className="text-sm text-muted-foreground">PNG, JPG up to 10MB</p>
                      </div>
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button
                onClick={() => setStep('filters')}
                disabled={!selfieFile && !selectedPresetId}
              >
                {selectedPresetId ? 'Continue with Preset' : 'Next: Set Filters'}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Filters */}
        {step === 'filters' && (
          <div className="space-y-4">
            {/* Show selected preset info */}
            {selectedPresetId && (
              <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold">
                        Using preset:{' '}
                        <span className="text-primary">
                          {presets.find((p) => p.id === selectedPresetId)?.name}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {presets.find((p) => p.id === selectedPresetId)?.activity_type && (
                        <span className="px-2 py-1 rounded-md bg-background border">
                          {presets.find((p) => p.id === selectedPresetId)?.activity_type}
                        </span>
                      )}
                      {presets.find((p) => p.id === selectedPresetId)?.country && (
                        <span className="px-2 py-1 rounded-md bg-background border">
                          {presets.find((p) => p.id === selectedPresetId)?.country}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedPresetId(null);
                      setActivityType('');
                      setCountry('');
                      setRegion('');
                    }}
                    className="shrink-0"
                  >
                    Clear
                  </Button>
                </div>
              </div>
            )}

            {/* Filters */}
            <div className="space-y-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Activity Type</Label>
                  <Select
                    value={activityType || '__all__'}
                    onValueChange={(value) => setActivityType(value === '__all__' ? '' : value)}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select activity..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All activities</SelectItem>
                      {activityOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Event Date</Label>
                  <Input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="h-11"
                  />
                  <p className="text-xs text-muted-foreground">Optional: Filter by event date</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">Location</Label>
                <div className="rounded-lg border bg-card p-4">
                  <LocationSelector
                    country={country}
                    state={region}
                    city=""
                    onCountryChange={setCountry}
                    onStateChange={setRegion}
                    onCityChange={() => {}}
                    hideCity={true}
                    className="space-y-4"
                  />
                </div>
              </div>
            </div>

            {/* Save as preset */}
            {selfieFile && (
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="save-preset"
                    checked={saveAsPreset}
                    onChange={(e) => setSaveAsPreset(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <Label htmlFor="save-preset" className="cursor-pointer text-sm font-medium">
                    Save search settings as preset
                  </Label>
                </div>
                {saveAsPreset && (
                  <Input
                    placeholder="Preset name (e.g., 'Surf profile')"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    className="h-10"
                  />
                )}
              </div>
            )}

            {/* Usage info */}
            {availability && (
              <div className="rounded-lg border-2 border-muted bg-muted/30 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Search quota</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {availability.description}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">
                      {availability.currentUsage} / {availability.limit ?? '∞'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep('upload')} disabled={isPending}>
                Back
              </Button>
              <Button onClick={handleSearch} disabled={isPending || !availability?.available}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  'Start Matching'
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Searching */}
        {step === 'searching' && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium">Searching for matches...</p>
            <p className="text-sm text-muted-foreground mt-2">This may take a few moments</p>
          </div>
        )}

        {/* Step 4: Results */}
        {step === 'results' && (
          <AIMatchingResults
            matches={searchResults}
            selectedPhotoIds={selectedPhotoIds}
            onSelectionChange={setSelectedPhotoIds}
            onAddToLibrary={handleAddToLibrary}
            onCancel={() => onOpenChange(false)}
            isPending={isPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
