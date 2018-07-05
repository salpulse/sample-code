import React from 'react';
import { merge } from 'lodash';
import { MentionsInput, Mention } from '../../contrib/react-mentions';
import PropTypes from 'prop-types';
import styled from 'styled-components';
import { Prompt } from 'react-router-dom';

import { highlightOrangeLighterMuch, salpulseBlueLighterMuch } from '../../helpers/style';

import defaultMentionsInputStyle from './defaultMentionsInputStyle';
import defaultMentionStyle from './defaultMentionStyle';

import ButtonClose from './lib/ButtonClose';
import ButtonSubmit from './lib/ButtonSubmit';
import CharsToGoDisplay from './lib/CharsToGoDisplay';

import MediaInputContainer from './MediaInputContainer';

// Uses package: https://github.com/signavio/react-mentions

const WrapperDiv = styled.div`
  flex: 1;
`;

export default class StoryInput extends React.Component {
  static MAX_MEDIA_FILES_IN_POST = 3;

  render() {
    let style = merge({}, defaultMentionsInputStyle, {
      input: {
        overflow: 'auto',
        height: 140,
      },
    });

    if (this.props.loading) {
      console.log('Not ready');
      return <div>loading...</div>;
    } else {
      console.log('Authorized');
      return (
        <WrapperDiv>
          <Prompt
            when={this.props.isDirty}
            message="You have started a story. Are you sure you want to abandon it?"
          />
          <MentionsInput
            value={this.props.value}
            onChange={this.props.onChange}
            style={style}
            markup="@[__display__](__type__:__id__)"
            allowSpaceInQuery={true}
            placeholder={this.props.placeholder}
          >
            <Mention
              type="user"
              trigger="@"
              data={this.props.data}
              renderSuggestion={(suggestion, search, highlightedDisplay) => (
                <div className="user">{highlightedDisplay}</div>
              )}
              style={defaultMentionStyle}
            />
          </MentionsInput>
          <CharsToGoDisplay
            error={this.props.error}
            charsLeftStr={this.props.charsLeftStr}
            charsLeftOK={this.props.charsLeftOK}
            errorBackgroundColor={
              this.props.type === 'value' ? salpulseBlueLighterMuch : highlightOrangeLighterMuch
            }
          />
          <MediaInputContainer
            maxMedia={StoryInput.MAX_MEDIA_FILES_IN_POST}
            onChange={this.props.onMediaChanged}
          />
          <ButtonSubmit onClick={this.props.onPost}>Share</ButtonSubmit>
          <ButtonClose onClick={this.props.onCancel} />
        </WrapperDiv>
      );
    }
  }
}

StoryInput.propTypes = {
  loading: PropTypes.bool,
  type: PropTypes.string,
  value: PropTypes.string,
  media: PropTypes.arrayOf(PropTypes.object),
  isDirty: PropTypes.bool,
  error: PropTypes.string,
  charsLeftStr: PropTypes.string,
  charsLeftOK: PropTypes.bool,
  onChange: PropTypes.func,
  onMediaChanged: PropTypes.func,
  onPost: PropTypes.func,
  onCancel: PropTypes.func,
  onInputComplete: PropTypes.func,
  placeholder: PropTypes.string,
  data: PropTypes.array,
};
