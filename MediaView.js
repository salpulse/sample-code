import React from 'react';
import PropTypes from 'prop-types';
import styled from 'styled-components';
import MediaFullScreenGalleryContainer from './MediaFullScreenGalleryContainer';

import { Cloudinary } from '../../api/cloudinary';

const MediaWrapper = styled.div`
  display block;
  text-align: center;
`;

const MediaItemWrapper = styled.div`
  display: block;
  margin: 1rem auto;
  &:hover {
    cursor: pointer;
  }
`;

const StyledImage = styled.img`
  max-width: 100%;
`;

const MAX_IMAGE_HEIGHT_IN_FEED = 400;

export default class MediaView extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      isGalleryOpen: false,
      clickedImageIndex: 0,
    };

    this.onImageClick = this.onImageClick.bind(this);
  }

  onImageClick = index => event => {
    event.preventDefault();
    this.setState({ clickedImageIndex: index });
    this.setState({ isGalleryOpen: true });
  };

  getImageURL(image, maxHeight = undefined) {
    const heightModifier = maxHeight ? `h_${Math.min(image.height, maxHeight)}/` : '';
    return `${Cloudinary.publicCredentials().root_url}/${
      Cloudinary.publicCredentials().cloud_name
    }/${heightModifier}${image.imageId}.png`;
  }

  getMediaGalleryImageURLs() {
    return this.props.media.map(image => this.getImageURL(image));
  }

  renderMediaItem(mediaItem, index) {
    return (
      mediaItem.source === 'cloudinary' && (
        <MediaItemWrapper key={mediaItem.imageId} onClick={this.onImageClick(index)}>
          {mediaItem.type === 'image' && (
            <StyledImage src={this.getImageURL(mediaItem, MAX_IMAGE_HEIGHT_IN_FEED)} />
          )}
          {mediaItem.type === 'video' && <div>Video not yet supported</div>}
        </MediaItemWrapper>
      )
    );
  }

  render() {
    return (
      <MediaWrapper>
        {this.props.media.map((mediaItem, index) => this.renderMediaItem(mediaItem, index))}
        {this.state.isGalleryOpen && (
          <MediaFullScreenGalleryContainer
            imageURLs={this.getMediaGalleryImageURLs()}
            openOnIndex={this.state.clickedImageIndex}
            onClose={() => {
              this.setState({ isGalleryOpen: false });
            }}
          />
        )}
      </MediaWrapper>
    );
  }
}

MediaView.propTypes = {
  media: PropTypes.arrayOf(PropTypes.object),
};
