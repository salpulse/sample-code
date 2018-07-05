import React from 'react';
import { Meteor } from 'meteor/meteor';
import { withTracker } from 'meteor/react-meteor-data';
import { compose, withState, withHandlers, lifecycle } from 'recompose';

import history from '../../routes/history';

import { Users } from '../../api/users';
import { Cloudinary } from '../../api/cloudinary';
import { CCElements } from '../../api/cc_elements';

import StoryInput from './StoryInput';

const MAX_FIELD_LEN = 2000;

export default (StoryInputContainer = compose(
  withState('value', 'setValue', ''),
  withState('media', 'setMedia', []),
  withState('isDirty', 'setIsDirty', false),
  withState('error', 'setError', ''),
  withState('charsLeftStr', 'setCharsLeftStr', undefined),
  withState('charsLeftOK', 'setCharsLeftOK', true),
  withHandlers({
    onChange: ({ setValue, setError, setCharsLeftStr, setCharsLeftOK, setIsDirty }) => (ev, newValue) => {
      var str;
      if (newValue && newValue.length > MAX_FIELD_LEN) {
        str = newValue.substring(0, MAX_FIELD_LEN);
        setError('Too many characters');
        setCharsLeftOK(false);
      } else {
        setError('');
        setCharsLeftOK(true);
        str = newValue;
      }
      setValue(str);
      if (str && str.length > 0) {
        setCharsLeftStr(`${MAX_FIELD_LEN - str.length}/${MAX_FIELD_LEN}`);
        setIsDirty(true);
      } else {
        setCharsLeftStr(undefined);
        setIsDirty(false);
      }
    },
    onMediaChanged: ({ media, setMedia, setIsDirty, setError }) => media => {
      setMedia(media);
      setIsDirty(media.length > 0);
      if (media.length === StoryInput.MAX_MEDIA_FILES_IN_POST) {
        setError(
          `Reached the limit of ${StoryInput.MAX_MEDIA_FILES_IN_POST} media file${
            media.length > 1 ? 's' : ''
          } in a story`,
        );
      }
    },
    onPost: ({
      setValue,
      value,
      media,
      setMedia,
      ccElement,
      setError,
      onInputComplete,
      setIsDirty,
    }) => event => {
      event.preventDefault();
      const story = value.trim();
      // console.log(story);

      if (story && story.length > MAX_FIELD_LEN) {
        setError(`Exceeded maximum length story of ${MAX_FIELD_LEN} characters`);
      } else if (!story || !story.length) {
        setError(`Please type something to share`);
      } else {
        const feedItem = {
          orgId: Session.get('orgId'),
          authorId: Meteor.userId(),
          ccElementId: ccElement._id,
          story,
          media: media.length ? media.slice(0) : undefined, // Make a copy of media state because we are going to clear it out
        };

        // Clear out the media state here so that componentWillUnmount
        // doesn't accidentally delete them
        setMedia([]);

        // console.log(feedItem);
        Meteor.call('feeds.insert.story', feedItem, (error, result) => {
          if (error) {
            setError(error.message);
          } else {
            setError('');
            setValue(''); // Clear out field ready for next story
            setIsDirty(false);
            onInputComplete();
          }
        });
      }
    },
    onCancel: ({ setValue, setError, onInputComplete, setIsDirty }) => event => {
      event.preventDefault();
      setError('');
      setValue(''); // Clear out field ready for next story
      setIsDirty(false);
      // NB: Any loaded media files will be deleted by the lifecycle:componentWillUnmount() method
      onInputComplete();
    },
  }),
  lifecycle({
    componentWillUnmount() {
      // This will catch the click away action as well as the cancel action
      // If media have been loaded to the image hosting service, but NOT saved into
      // a post, we delete the media from the hosting service
      if (this.props.media.length) {
        // console.log(`deleting ${this.props.media.length} media`);
        Meteor.call('cloudinary.deleteMedia', this.props.media);
      }
    },
  }),

  withTracker(({ ccElement }) => {
    const orgId = Session.get('orgId');
    const loading = !Meteor.subscribe('users.forOrg', orgId).ready();
    const users = loading ? [] : Users.findUserFullNameAllInOrg(orgId).fetch();

    // Map users into a format usable by MentionsInput package
    const mappedUsers = users.map(user => ({
      display: `${user.profile.firstName} ${user.profile.lastName}`,
      id: user._id,
    }));

    return {
      loading,
      data: mappedUsers,
      placeholder: `Share your thoughts or a story about ${CCElements.getNarrativePrintable(
        ccElement,
      )} Use @ to mention a colleague`,
    };
  }),
)(StoryInput));
